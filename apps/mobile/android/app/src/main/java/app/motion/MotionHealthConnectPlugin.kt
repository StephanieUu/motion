package app.motion

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import androidx.activity.result.ActivityResult
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.PluginMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.reflect.KClass

@CapacitorPlugin(name = "MotionHealthConnect")
class MotionHealthConnectPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val client by lazy { HealthConnectClient.getOrCreate(context) }
    private var permissionContract = PermissionController.createRequestPermissionResultContract()
    private var requestedPermissions: Set<String> = emptySet()

    private val classes: Map<String, KClass<out Record>> = mapOf(
        "Weight" to WeightRecord::class, "BodyFat" to BodyFatRecord::class,
        "Steps" to StepsRecord::class, "ExerciseSession" to ExerciseSessionRecord::class,
        "ActiveCaloriesBurned" to ActiveCaloriesBurnedRecord::class, "SleepSession" to SleepSessionRecord::class,
        "RestingHeartRate" to RestingHeartRateRecord::class, "HeartRate" to HeartRateRecord::class
    )

    @PluginMethod
    fun availability(call: PluginCall) {
        val status = when (HealthConnectClient.getSdkStatus(context, "com.google.android.apps.healthdata")) {
            HealthConnectClient.SDK_AVAILABLE -> "AVAILABLE"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "PROVIDER_UPDATE_REQUIRED"
            HealthConnectClient.SDK_UNAVAILABLE -> "UNAVAILABLE"
            else -> "UNSUPPORTED"
        }
        call.resolve(JSObject().put("status", status))
    }

    @PluginMethod
    fun grantedPermissions(call: PluginCall) = launchCall(call) {
        permissionResult(client.permissionController.getGrantedPermissions())
    }

    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        val types = call.getArray("recordTypes") ?: JSArray()
        requestedPermissions = (0 until types.length()).mapNotNull { classes[types.getString(it)] }
            .map { HealthPermission.getReadPermission(it) }.toSet()
        if (requestedPermissions.isEmpty()) { call.resolve(JSObject().put("recordTypes", JSArray())); return }
        val intent = permissionContract.createIntent(context, requestedPermissions)
        startActivityForResult(call, intent, "permissionResult")
    }

    @ActivityCallback
    private fun permissionResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        launchCall(call) { permissionResult(client.permissionController.getGrantedPermissions()) }
    }

    private fun permissionResult(granted: Set<String>): JSObject {
        val types = classes.filterValues { granted.contains(HealthPermission.getReadPermission(it)) }.keys
        return JSObject().put("recordTypes", JSArray(types.toList()))
    }

    @PluginMethod
    fun syncRecord(call: PluginCall) = launchCall(call) {
        val type = call.getString("recordType") ?: throw IllegalArgumentException("recordType is required")
        val recordClass = classes[type] ?: throw IllegalArgumentException("Unsupported record type")
        val granted = client.permissionController.getGrantedPermissions()
        if (!granted.contains(HealthPermission.getReadPermission(recordClass))) throw SecurityException("Permission missing")
        val fromDate = LocalDate.parse(call.getString("from"))
        val throughDate = LocalDate.parse(call.getString("through"))
        val zone = ZoneId.of(call.getString("zoneId") ?: ZoneId.systemDefault().id)
        val from = fromDate.atStartOfDay(zone).toInstant()
        val through = throughDate.plusDays(1).atStartOfDay(zone).toInstant()
        val upserts = JSArray()
        val deletions = JSArray()
        val suppliedToken = call.getString("changesToken")
        var nextToken: String
        if (suppliedToken != null) {
            nextToken = drainChanges(suppliedToken, zone, upserts, deletions) ?: return@launchCall expiredResult()
        } else {
            // The token is intentionally captured before the bounded snapshot. Changes racing the snapshot
            // are then replayed below, so no record can fall between initial import and incremental sync.
            val snapshotToken = client.getChangesToken(ChangesTokenRequest(setOf(recordClass)))
            when (type) {
                "Weight" -> readWeightSnapshot(from, through, zone, upserts)
                "BodyFat" -> readBodyFatSnapshot(from, through, zone, upserts)
            }
            nextToken = drainChanges(snapshotToken, zone, upserts, deletions) ?: return@launchCall expiredResult()
        }
        val summaries = aggregateSummaries(type, fromDate, throughDate, zone, call.getObject("summaryZones"))
        JSObject().put("upserts", upserts).put("deletions", deletions).put("summaries", summaries)
            .put("nextToken", nextToken).put("tokenExpired", false)
    }

    private suspend fun drainChanges(startToken: String, zone: ZoneId, upserts: JSArray, deletions: JSArray): String? {
        var token = startToken
        while (true) {
            val changes = client.getChanges(token)
            if (changes.changesTokenExpired) return null
            changes.changes.forEach { change -> when (change) {
                is DeletionChange -> deletions.put(change.recordId)
                is UpsertionChange -> when (val record = change.record) {
                    is WeightRecord -> if (record.metadata.dataOrigin.packageName != context.packageName)
                        upserts.put(bodyRecord(record.metadata.id, "Weight", record.time,
                            record.weight.inKilograms, record.metadata.dataOrigin.packageName, zone))
                    is BodyFatRecord -> if (record.metadata.dataOrigin.packageName != context.packageName)
                        upserts.put(bodyRecord(record.metadata.id, "BodyFat", record.time,
                            record.percentage.value, record.metadata.dataOrigin.packageName, zone))
                }
            } }
            token = changes.nextChangesToken
            if (!changes.hasMore) return token
        }
    }

    private suspend fun readWeightSnapshot(from: Instant, through: Instant, zone: ZoneId, upserts: JSArray) {
        var pageToken: String? = null
        do {
            val page = client.readRecords(ReadRecordsRequest(WeightRecord::class,
                TimeRangeFilter.between(from, through), pageToken = pageToken))
            page.records.filter { it.metadata.dataOrigin.packageName != context.packageName }.forEach {
                upserts.put(bodyRecord(it.metadata.id, "Weight", it.time, it.weight.inKilograms,
                    it.metadata.dataOrigin.packageName, zone))
            }
            pageToken = page.pageToken
        } while (pageToken != null)
    }

    private suspend fun readBodyFatSnapshot(from: Instant, through: Instant, zone: ZoneId, upserts: JSArray) {
        var pageToken: String? = null
        do {
            val page = client.readRecords(ReadRecordsRequest(BodyFatRecord::class,
                TimeRangeFilter.between(from, through), pageToken = pageToken))
            page.records.filter { it.metadata.dataOrigin.packageName != context.packageName }.forEach {
                upserts.put(bodyRecord(it.metadata.id, "BodyFat", it.time, it.percentage.value,
                    it.metadata.dataOrigin.packageName, zone))
            }
            pageToken = page.pageToken
        } while (pageToken != null)
    }

    private fun expiredResult() = JSObject().put("upserts", JSArray()).put("deletions", JSArray())
        .put("summaries", JSArray()).put("nextToken", JSObject.NULL).put("tokenExpired", true)

    private suspend fun aggregateSummaries(type: String, from: LocalDate, through: LocalDate,
        defaultZone: ZoneId, summaryZones: JSObject?): JSArray {
        val summaries = JSArray()
        var date = from
        while (date <= through) {
            val zone = summaryZones?.optString(date.toString())?.takeIf { it.isNotBlank() }?.let(ZoneId::of)
                ?: defaultZone
            val start = date.atStartOfDay(zone).toInstant(); val end = date.plusDays(1).atStartOfDay(zone).toInstant()
            val item = JSObject().put("localDate", date.toString()).put("steps", JSObject.NULL)
                .put("activeCaloriesKcal", JSObject.NULL).put("exerciseMinutes", JSObject.NULL)
                .put("sleepMinutes", JSObject.NULL).put("restingHeartRate", JSObject.NULL)
                .put("averageHeartRate", JSObject.NULL)
            when (type) {
                "Steps" -> item.putNullable("steps", client.aggregate(AggregateRequest(
                    setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(start,end)))[StepsRecord.COUNT_TOTAL])
                "ActiveCaloriesBurned" -> item.putNullable("activeCaloriesKcal", client.aggregate(AggregateRequest(
                    setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL), TimeRangeFilter.between(start,end)))
                    [ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories)
                "ExerciseSession" -> item.putNullable("exerciseMinutes", client.aggregate(AggregateRequest(
                    setOf(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL), TimeRangeFilter.between(start,end)))
                    [ExerciseSessionRecord.EXERCISE_DURATION_TOTAL]?.toMinutes())
                "SleepSession" -> item.putNullable("sleepMinutes", client.aggregate(AggregateRequest(
                    setOf(SleepSessionRecord.SLEEP_DURATION_TOTAL), TimeRangeFilter.between(start,end)))
                    [SleepSessionRecord.SLEEP_DURATION_TOTAL]?.toMinutes())
                "HeartRate" -> item.putNullable("averageHeartRate", client.aggregate(AggregateRequest(
                    setOf(HeartRateRecord.BPM_AVG), TimeRangeFilter.between(start,end)))[HeartRateRecord.BPM_AVG])
                "RestingHeartRate" -> item.putNullable("restingHeartRate", client.aggregate(AggregateRequest(
                    setOf(RestingHeartRateRecord.BPM_AVG), TimeRangeFilter.between(start,end)))
                    [RestingHeartRateRecord.BPM_AVG])
            }
            item.put("sourceSummaryJson", JSObject().put("recordTypes",JSObject().put(type,true)).put("zoneId",zone.id).toString())
                .put("lastSyncedAt", Instant.now().toString())
            if (type !in setOf("Weight","BodyFat")) summaries.put(item)
            date = date.plusDays(1)
        }
        return summaries
    }

    private fun JSObject.putNullable(key: String, value: Any?): JSObject = put(key, value ?: JSObject.NULL)

    private fun bodyRecord(id: String, type: String, time: Instant, value: Double, source: String,
        zone: ZoneId): JSObject {
        return JSObject().put("externalRecordId", id).put("recordType", type).put("measuredAt", time.toString())
            .put("localDate", time.atZone(zone).toLocalDate().toString())
            .put("value", value).put("sourceApp", source)
    }

    private fun launchCall(call: PluginCall, work: suspend () -> JSObject) {
        scope.launch { try { val value = withContext(Dispatchers.IO) { work() }; call.resolve(value) }
            catch (_: SecurityException) { call.reject("HEALTH_PERMISSION_MISSING") }
            catch (_: Exception) { call.reject("HEALTH_CONNECT_OPERATION_FAILED") } }
    }
}
