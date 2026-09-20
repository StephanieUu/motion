package app.motion

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import javax.net.ssl.SSLException
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties

@CapacitorPlugin(name = "MotionAi")
class MotionAiPlugin : Plugin() {
    private val alias = "motion-ai-credentials-v1"
    private val preferences by lazy { context.getSharedPreferences("motion_ai_secure", Activity.MODE_PRIVATE) }

    @PluginMethod
    fun setCredential(call: PluginCall) {
        val provider = provider(call) ?: return
        val secret = call.getString("secret")?.trim().orEmpty()
        if (secret.isEmpty()) { call.reject("SECRET_REQUIRED"); return }
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val encrypted = cipher.doFinal(secret.toByteArray(StandardCharsets.UTF_8))
            val stored = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(encrypted, Base64.NO_WRAP)
            preferences.edit().putString(provider, stored).apply()
            call.resolve()
        } catch (_: Exception) { call.reject("CREDENTIAL_STORAGE_FAILED") }
    }

    @PluginMethod
    fun hasCredential(call: PluginCall) {
        val provider = provider(call) ?: return
        call.resolve(JSObject().put("value", preferences.contains(provider)))
    }

    @PluginMethod
    fun deleteCredential(call: PluginCall) {
        val provider = provider(call) ?: return
        preferences.edit().remove(provider).apply()
        call.resolve()
    }

    @PluginMethod
    fun request(call: PluginCall) {
        val provider = provider(call) ?: return
        val model = call.getString("model")?.trim().orEmpty()
        val prompt = call.getString("prompt")?.trim().orEmpty()
        val image = call.getString("imageBase64")
        val maxOutputTokens = (call.getInt("maxOutputTokens") ?: 1200).coerceIn(1, 4096)
        val outputMode = call.getString("outputMode") ?: "TEXT"
        val responseSchema = call.getObject("responseSchema")
        if (model.isEmpty() || prompt.isEmpty() || (outputMode != "TEXT" && outputMode != "JSON_SCHEMA") ||
            (outputMode == "JSON_SCHEMA" && responseSchema == null)) { call.reject("INVALID_REQUEST"); return }
        Thread {
            try {
                val secret = readSecret(provider)
                val result = if (provider == "GEMINI") requestGemini(secret, model, prompt, image, maxOutputTokens,
                    outputMode, responseSchema)
                    else requestDeepSeek(secret, model, prompt, image, maxOutputTokens, outputMode)
                call.resolve(JSObject().put("body", result.second).put("status", result.first))
            } catch (error: java.net.SocketTimeoutException) { call.reject("TIMEOUT")
            } catch (_: SSLException) { call.reject("TLS")
            } catch (_: SecurityException) { call.reject("AUTH_LOCAL")
            } catch (_: Exception) { call.reject("NETWORK") }
        }.start()
    }

    @PluginMethod
    fun chooseMealImage(call: PluginCall) {
        val intent = if (Build.VERSION.SDK_INT >= 33) Intent(MediaStore.ACTION_PICK_IMAGES)
            else Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
        intent.type = "image/*"
        startActivityForResult(call, intent, "mealImagePicked")
    }

    @ActivityCallback
    private fun mealImagePicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { call.reject("IMAGE_NOT_SELECTED"); return }
        Thread {
            try {
                val original = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    val source = ImageDecoder.createSource(context.contentResolver, uri)
                    ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                        val longest = maxOf(info.size.width, info.size.height)
                        if (longest > 1280) {
                            val scale = 1280f / longest
                            decoder.setTargetSize((info.size.width * scale).toInt().coerceAtLeast(1),
                                (info.size.height * scale).toInt().coerceAtLeast(1))
                        }
                    }
                } else {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("IMAGE_READ_FAILED")
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2560) sample *= 2
                    val options = BitmapFactory.Options().apply { inSampleSize = sample }
                    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
                        ?: throw IllegalArgumentException("IMAGE_READ_FAILED")
                }
                val longest = maxOf(original.width, original.height)
                val scale = if (longest > 1280) 1280f / longest else 1f
                val resized = if (scale < 1f) Bitmap.createScaledBitmap(original,
                    (original.width * scale).toInt(), (original.height * scale).toInt(), true) else original
                val bytes = ByteArrayOutputStream().use { stream ->
                    resized.compress(Bitmap.CompressFormat.JPEG, 88, stream); stream.toByteArray()
                }
                val dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                Log.i("MotionAi", "Meal image prepared mime=image/jpeg width=${resized.width} height=${resized.height} bytes=${bytes.size}")
                call.resolve(JSObject().put("dataUrl", dataUrl).put("width", resized.width).put("height", resized.height)
                    .put("mimeType", "image/jpeg").put("byteSize", bytes.size))
                if (resized !== original) resized.recycle()
                original.recycle()
            } catch (_: Exception) { call.reject("IMAGE_READ_FAILED") }
        }.start()
    }

    private fun provider(call: PluginCall): String? {
        val value = call.getString("provider")
        if (value != "GEMINI" && value != "DEEPSEEK") { call.reject("INVALID_PROVIDER"); return null }
        return value
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }

    private fun readSecret(provider: String): String {
        try {
            val stored = preferences.getString(provider, null) ?: throw SecurityException("AUTH")
            val parts = stored.split(':', limit = 2)
            if (parts.size != 2) throw SecurityException("AUTH")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
            return String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8)
        } catch (_: SecurityException) {
            throw SecurityException("AUTH")
        } catch (_: Exception) {
            // Includes malformed Base64 and an invalid GCM authentication tag. Never
            // expose encrypted material or native crypto details across the bridge.
            throw SecurityException("AUTH")
        }
    }

    private fun requestGemini(secret: String, model: String, prompt: String, image: String?,
        maxOutputTokens: Int, outputMode: String, responseSchema: JSONObject?): Pair<Int, String> {
        val parts = JSONArray().put(JSONObject().put("text", prompt))
        if (!image.isNullOrEmpty()) parts.put(JSONObject().put("inline_data", JSONObject()
            .put("mime_type", "image/jpeg").put("data", image)))
        val generationConfig = JSONObject().put("maxOutputTokens", maxOutputTokens)
        if (outputMode == "JSON_SCHEMA") generationConfig.put("responseFormat", JSONObject().put("text",
            JSONObject().put("mimeType", "application/json").put("schema", responseSchema)))
        val body = JSONObject().put("contents", JSONArray().put(JSONObject().put("parts", parts)))
            .put("generationConfig", generationConfig)
        val encodedModel = URLEncoder.encode(model, "UTF-8").replace("+", "%20")
        val endpoint = "https://generativelanguage.googleapis.com/v1beta/models/$encodedModel:generateContent"
        return post(endpoint, body.toString(), mapOf("x-goog-api-key" to secret))
    }

    private fun requestDeepSeek(secret: String, model: String, prompt: String, image: String?,
        maxOutputTokens: Int, outputMode: String): Pair<Int, String> {
        if (!image.isNullOrEmpty()) throw IllegalArgumentException("PROVIDER")
        val body = JSONObject().put("model", model).put("max_tokens", maxOutputTokens)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", prompt)))
        if (outputMode == "JSON_SCHEMA") body.put("response_format", JSONObject().put("type", "json_object"))
        return post("https://api.deepseek.com/chat/completions", body.toString(), mapOf("Authorization" to "Bearer $secret"))
    }

    private fun post(endpoint: String, body: String, headers: Map<String, String>): Pair<Int, String> {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"; connection.connectTimeout = 20_000; connection.readTimeout = 30_000
        connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
        headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
        connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val response = if (status in 200..299) stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            else { stream?.close(); "" }
        connection.disconnect()
        return status to response
    }
}
