// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { bodyTrend, bodyTrendRange, parseBodyMeasurementOcr, resolveBodyMetricSnapshot,
  type BodyMeasurement } from '@motion/domain'
import { Database, type SqlDriver, type SqlRow, type SqlValue } from '../sqlite/Database'
import { migrateDatabase, migrations } from '../migrations'
import { BodyRepository } from './BodyRepository'
import { NutritionRepository } from './NutritionRepository'
import { BodyService } from '../../features/body/bodyService'
import type { BodyOcrPlugin, HealthConnectPlugin, HealthRecordType } from '../../platform/body/bodyNative'

class NodeDriver implements SqlDriver {
  constructor(readonly sqlite: DatabaseSync) {}
  async query<T extends SqlRow>(sql: string, values: SqlValue[] = []): Promise<T[]> { return this.sqlite.prepare(sql).all(...values) as T[] }
  async run(sql: string, values: SqlValue[] = []): Promise<void> { this.sqlite.prepare(sql).run(...values) }
  async execute(sql: string): Promise<void> { this.sqlite.exec(sql) }
  async begin(): Promise<void> { this.sqlite.exec('BEGIN IMMEDIATE') }
  async commit(): Promise<void> { this.sqlite.exec('COMMIT') }
  async rollback(): Promise<void> { this.sqlite.exec('ROLLBACK') }
}
const opened: DatabaseSync[] = []
function open() { const sqlite = new DatabaseSync(':memory:'); opened.push(sqlite); return { sqlite, db: new Database(new NodeDriver(sqlite)) } }
async function ready(version = 10) { const result = open(); await migrateDatabase(result.db, migrations.slice(0, version)); return result }
afterEach(() => opened.splice(0).forEach((sqlite) => sqlite.close()))

describe('M9 body migration', () => {
  it('migrates a populated 008 database without changing M7 body or nutrition history', async () => {
    const { db } = await ready(8)
    await db.run(`INSERT INTO body_measurements
      (id,measured_at,local_date,source_type,weight_kg,user_verified,created_at) VALUES (?,?,?,?,?,?,?)`,
    ['old-weight','2026-09-01T08:00:00Z','2026-09-01','MANUAL',68.2,1,'2026-09-01T08:00:00Z'])
    await db.run(`INSERT INTO workout_contents
      (id,content_kind,title,source_type,user_visibility,created_at,updated_at)
      VALUES ('kept-workout','FOLLOW_ALONG','kept','MANUAL','ACTIVE','now','now')`)
    await db.run(`INSERT INTO nutrition_plan_runs
      (id,base_strategy,status,starts_on,high_protein,tre_enabled,config_version,created_at,updated_at)
      VALUES ('kept-run','MAINTENANCE','ACTIVE','2026-09-01',0,0,1,'now','now')`)
    await db.run(`INSERT INTO daily_nutrition_targets
      (id,local_date,calories_min,calories_max,protein_min_g,protein_max_g,nutrition_plan_run_id,day_type,calculation_version,rationale_json,created_at)
      VALUES ('target','2026-09-01',1400,1650,90,105,'kept-run','NORMAL','M8_V1','{"weight":68.2}','2026-09-01T08:00:00Z')`)
    const targetBefore = await db.query("SELECT * FROM daily_nutrition_targets WHERE id='target'")
    await migrateDatabase(db)
    expect(await db.query('SELECT id,weight_kg,source_type,user_verified FROM body_measurements')).toEqual([
      { id:'old-weight', weight_kg:68.2, source_type:'MANUAL', user_verified:1 },
    ])
    expect(await db.query("SELECT * FROM daily_nutrition_targets WHERE id='target'")).toEqual(targetBefore)
    expect(await db.query("SELECT id,title FROM workout_contents WHERE id='kept-workout'")).toEqual([{id:'kept-workout',title:'kept'}])
    expect(await db.query("SELECT id,status FROM nutrition_plan_runs WHERE id='kept-run'")).toEqual([{id:'kept-run',status:'ACTIVE'}])
    expect((await db.query<{ user_version:number }>('PRAGMA user_version'))[0]?.user_version).toBe(10)
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([])
  })

  it('allows partial measurements while enforcing metric, JSON and external identity constraints', async () => {
    const { db } = await ready()
    const now='2026-09-16T08:00:00Z'
    await db.run(`INSERT INTO body_measurements (id,measured_at,local_date,source_type,body_fat_percent,user_verified,
      external_record_id,created_at,updated_at) VALUES ('fat',?,?,'HEALTH_CONNECT',21.3,0,'external-1',?,?)`,
    [now,'2026-09-16',now,now])
    await expect(db.run(`INSERT INTO body_measurements (id,measured_at,local_date,source_type,user_verified,created_at,updated_at)
      VALUES ('empty',?,?,'MANUAL',1,?,?)`,[now,'2026-09-16',now,now])).rejects.toThrow()
    await expect(db.run(`INSERT INTO body_measurements (id,measured_at,local_date,source_type,weight_kg,raw_data_json,user_verified,created_at,updated_at)
      VALUES ('json',?,?,'MANUAL',65,'bad',1,?,?)`,[now,'2026-09-16',now,now])).rejects.toThrow()
    await expect(db.run(`INSERT INTO body_measurements (id,measured_at,local_date,source_type,weight_kg,user_verified,external_record_id,created_at,updated_at)
      VALUES ('duplicate',?,?,'HEALTH_CONNECT',65,0,'external-1',?,?)`,[now,'2026-09-16',now,now])).rejects.toThrow()
    await db.run(`INSERT INTO body_measurements (id,measured_at,local_date,source_type,weight_kg,user_verified,
      external_record_id,source_app,created_at,updated_at) VALUES ('unrelated',?,?,'OTHER',65,1,'external-1','other',?,?)`,
    [now,'2026-09-16',now,now])
  })

  it('rolls migration 009 back atomically if a later statement fails', async () => {
    const { db } = await ready(8)
    const broken = [...migrations.slice(0,8), { version:9, sql:`${migrations[8]!.sql}\nINSERT INTO missing_table VALUES (1);` }]
    await expect(migrateDatabase(db, broken)).rejects.toThrow()
    expect((await db.query<{ user_version:number }>('PRAGMA user_version'))[0]?.user_version).toBe(8)
    const columns=await db.query<{name:string}>('PRAGMA table_info(body_measurements)')
    expect(columns.some((column)=>column.name==='body_fat_percent')).toBe(false)
  })
})

describe('M9 body domain and repository', () => {
  const base: BodyMeasurement = { id:'a',measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',
    sourceType:'HEALTH_CONNECT',weightKg:65,bodyFatPercent:null,bmi:null,fatMassKg:null,muscleMassKg:null,
    skeletalMuscle:null,bodyWaterPercent:null,visceralFatLevel:null,boneMassKg:null,bmrKcal:null,bodyAge:null,
    rawDataJson:null,confidenceLevel:null,userVerified:false,externalRecordId:'a',sourceApp:'source',
    createdAt:'2026-09-16T08:00:00Z',updatedAt:'2026-09-16T08:00:00Z' }

  it('resolves metrics independently, prefers verified exact-time data and never interpolates trends', () => {
    const records: BodyMeasurement[] = [base,
      {...base,id:'fat',weightKg:null,bodyFatPercent:21.3,measuredAt:'2026-09-15T08:00:00Z',localDate:'2026-09-15'},
      {...base,id:'verified',weightKg:64.8,userVerified:true,externalRecordId:null,sourceType:'MANUAL'},
      {...base,id:'same-day-later',weightKg:64.9,measuredAt:'2026-09-15T20:00:00Z',localDate:'2026-09-15'},]
    expect(resolveBodyMetricSnapshot(records)).toMatchObject({weightKg:{value:64.8,measurementId:'verified'},bodyFatPercent:{value:21.3}})
    expect(bodyTrend(records,'weightKg','2026-09-01','2026-09-16').map((point)=>[point.localDate,point.value]))
      .toEqual([['2026-09-15',64.9],['2026-09-16',64.8]])
    expect(bodyTrendRange('2026-09-16','30D')).toEqual({from:'2026-08-18',through:'2026-09-16'})
    expect(bodyTrendRange('2026-09-16','3M')).toEqual({from:'2026-06-19',through:'2026-09-16'})
    expect(bodyTrendRange('2026-09-16','1Y')).toEqual({from:'2025-09-17',through:'2026-09-16'})
  })

  it('uses the newest effective measurement before verification and resolves exact collisions deterministically', () => {
    const olderVerified = { ...base, id:'older-manual', measuredAt:'2026-09-01T08:00:00Z',
      localDate:'2026-09-01', sourceType:'MANUAL' as const, externalRecordId:null, userVerified:true, weightKg:66 }
    const newerHealth = { ...base, id:'newer-health', measuredAt:'2026-09-10T08:00:00Z',
      localDate:'2026-09-10', weightKg:65.4 }
    expect(resolveBodyMetricSnapshot([olderVerified,newerHealth]).weightKg)
      .toMatchObject({value:65.4,measurementId:'newer-health'})
    const exactManual = { ...newerHealth, id:'manual-collision', sourceType:'MANUAL' as const,
      externalRecordId:null, userVerified:false, weightKg:65.3 }
    expect(resolveBodyMetricSnapshot([newerHealth,exactManual]).weightKg)
      .toMatchObject({value:65.3,measurementId:'manual-collision'})
  })

  it('supports manual/BIA, body-fat-only Health records, dedupe and user record deletion', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    const manual=await repository.insert({measuredAt:'2026-09-15T08:00:00Z',localDate:'2026-09-15',sourceType:'MANUAL',
      weightKg:65.8,muscleMassKg:48.2,bodyWaterPercent:54.1,userVerified:true})
    await repository.upsertHealth({measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',bodyFatPercent:21.3,
      externalRecordId:'fat-1',sourceApp:'test.health'})
    await repository.upsertHealth({measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',bodyFatPercent:21.4,
      externalRecordId:'fat-1',sourceApp:'test.health'})
    expect(await repository.measurements()).toHaveLength(2)
    expect(await repository.measurement((await repository.measurements()).find((item)=>item.externalRecordId==='fat-1')!.id))
      .toMatchObject({bodyFatPercent:21.4,externalRecordId:'fat-1'})
    expect((await new NutritionRepository(db).latestWeightOnOrBefore('2026-09-16'))?.id).toBe(manual.id)
    await repository.deleteUserRecord(manual.id)
    expect(await repository.measurement(manual.id)).toBeNull()
  })

  it('edits user records without discarding metrics while retaining confirmed Health Connect provenance', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    const manual=await repository.insert({measuredAt:'2026-09-15T08:00:00Z',localDate:'2026-09-15',sourceType:'MANUAL',
      weightKg:65.8,muscleMassKg:48.2,userVerified:true})
    await repository.updateUserRecord(manual.id,{measuredAt:manual.measuredAt,localDate:manual.localDate,weightKg:65.6})
    expect(await repository.measurement(manual.id)).toMatchObject({weightKg:65.6,muscleMassKg:48.2,userVerified:true})
    const health=await repository.upsertHealth({measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',weightKg:66,
      externalRecordId:'managed',sourceApp:'fake'})
    await repository.updateUserRecord(health.id,{measuredAt:health.measuredAt,localDate:health.localDate,weightKg:65})
    await repository.upsertHealth({measuredAt:'2026-09-16T09:00:00Z',localDate:'2026-09-16',weightKg:67,
      externalRecordId:'managed',sourceApp:'fake'})
    await repository.deleteHealthExternal('managed')
    expect(await repository.measurement(health.id)).toMatchObject({sourceType:'HEALTH_CONNECT',externalRecordId:'managed',
      sourceApp:'fake',userVerified:true,weightKg:65,measuredAt:'2026-09-16T08:00:00Z'})
  })

  it('parses unit-aware Chinese OCR fields and leaves malformed or absent metrics blank', () => {
    expect(parseBodyMeasurementOcr(`体重 65.8 kg\n体脂率 21.3 %\nBMI 22.4\n脂肪量 14.0 kg\n肌肉量 48.2 kg\n体水分 54.1 %\n内脏脂肪等级 6\n骨量 2.4kg\n基础代谢 1420 kcal\n身体年龄 29岁`))
      .toEqual({weightKg:65.8,bodyFatPercent:21.3,bmi:22.4,fatMassKg:14,muscleMassKg:48.2,
        bodyWaterPercent:54.1,visceralFatLevel:6,boneMassKg:2.4,bmrKcal:1420,bodyAge:29})
    expect(parseBodyMeasurementOcr('体重 -- kg\n随机文字')).toEqual({})
    expect(parseBodyMeasurementOcr('体脂肪率 18.6％')).toEqual({bodyFatPercent:18.6})
  })

  it('parses a long Boohee report with split labels, values and units without using reference values', () => {
    const report = `薄荷身体报告
64.35 公斤
参考范围 52.0 - 63.0 公斤
BMI
23.9
标准 18.5 - 23.9
体脂
33.3
%
同龄平均 28.1%
皮下脂肪率 23.7%
内脏脂肪等级
10级
肌肉率 61.2%
肌肉量
39.4 kg
骨骼肌率
34.4%
骨骼肌量 22.1kg
体水分 30.6 47.6 标准
脂肪量 21.4
骨量
3.5 kg
基础代谢
1303 千卡
身体年龄
30岁
标准指标
标准基础代谢 1309 kcal
同龄人对比
BMI 23.8`
    expect(parseBodyMeasurementOcr(report)).toEqual({
      weightKg:64.35,bmi:23.9,bodyFatPercent:33.3,visceralFatLevel:10,muscleMassKg:39.4,
      skeletalMuscle:34.4,bodyWaterPercent:47.6,fatMassKg:21.4,boneMassKg:3.5,bmrKcal:1303,bodyAge:30,
    })
    expect(parseBodyMeasurementOcr('体重64.35公斤\n体脂率33.3%\n内脏脂肪等级10级\nBMR 1303 kcal\n体年龄30'))
      .toEqual({weightKg:64.35,bodyFatPercent:33.3,visceralFatLevel:10,bmrKcal:1303,bodyAge:30})
  })
})

describe('M9 OCR and Health Connect service boundaries', () => {
  it('passes requested permission subsets through without expanding them and returns actual grants', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    const actual=new Set<HealthRecordType>(['Weight','Steps','SleepSession'])
    const requests:HealthRecordType[][]=[]
    const health:HealthConnectPlugin={availability:async()=>({status:'AVAILABLE'}),
      grantedPermissions:async()=>({recordTypes:[...actual]}),
      requestHealthPermissions:async({recordTypes})=>{requests.push(recordTypes); return {recordTypes:recordTypes.filter((type)=>actual.has(type))}},
      syncRecord:async()=>({upserts:[],deletions:[],summaries:[],nextToken:'token'})}
    const service=new BodyService(repository,health,{} as BodyOcrPlugin)
    await expect(service.requestPermissions(['Weight'])).resolves.toEqual({recordTypes:['Weight']})
    await expect(service.requestPermissions(['Weight','BodyFat'])).resolves.toEqual({recordTypes:['Weight']})
    await expect(service.requestPermissions(['Steps'])).resolves.toEqual({recordTypes:['Steps']})
    await expect(service.requestPermissions(['SleepSession','HeartRate'])).resolves.toEqual({recordTypes:['SleepSession']})
    expect(requests).toEqual([['Weight'],['Weight','BodyFat'],['Steps'],['SleepSession','HeartRate']])
  })

  it('keeps OCR as an editable draft until explicit confirmation', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    const ocr: BodyOcrPlugin={chooseAndRecognize:async()=>({text:'体重 65.8 kg\n体脂率 21.3%'})}
    const health={} as HealthConnectPlugin
    const service=new BodyService(repository,health,ocr,()=>new Date('2026-09-16T12:00:00Z'))
    const draft=await service.recognizeScreenshot()
    expect(await repository.measurements()).toEqual([])
    await service.confirmScreenshot(draft,{...draft.values,weightKg:65.6,measuredAt:'2026-09-16T12:00:00Z',localDate:'2026-09-16'})
    expect(await repository.measurements()).toMatchObject([{sourceType:'SCREENSHOT_OCR',userVerified:true,weightKg:65.6}])
  })

  it('records OCR failure without creating a Body measurement', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    const service=new BodyService(repository,{} as HealthConnectPlugin,
      {chooseAndRecognize:async()=>{throw new Error('OCR_FAILED')}})
    await expect(service.recognizeScreenshot()).rejects.toThrow('OCR_FAILED')
    expect(await repository.measurements()).toEqual([])
    expect(await db.query('SELECT status,error_message FROM measurement_imports')).toEqual([
      {status:'FAILED',error_message:'OCR_FAILED'},
    ])
  })

  it('treats picker cancellation as rejected without a pending Body measurement or raw error data', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    const service=new BodyService(repository,{} as HealthConnectPlugin,
      {chooseAndRecognize:async()=>{throw new Error('IMAGE_NOT_SELECTED: content://must-not-be-stored')}})
    await expect(service.recognizeScreenshot()).rejects.toThrow('IMAGE_NOT_SELECTED')
    expect(await repository.measurements()).toEqual([])
    expect(await db.query('SELECT status,error_message,raw_ocr_text FROM measurement_imports')).toEqual([
      {status:'REJECTED',error_message:'IMAGE_NOT_SELECTED',raw_ocr_text:null},
    ])
  })

  it('handles unavailable/partial access, independent records, token reuse, dedupe and deletion', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db); const calls:Array<{recordType:HealthRecordType;changesToken?:string}>=[]
    let pass=0
    const health:HealthConnectPlugin={availability:async()=>({status:'AVAILABLE'}),
      grantedPermissions:async()=>({recordTypes:['Weight','BodyFat']}),requestHealthPermissions:async({recordTypes})=>({recordTypes}),
      syncRecord:async(options)=>{calls.push(options); pass++
        return {upserts:pass<=2?[{externalRecordId:options.recordType==='Weight'?'weight-1':'fat-1',recordType:options.recordType as 'Weight'|'BodyFat',measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',value:options.recordType==='Weight'?66:20,sourceApp:'fake'}]:[],
          deletions:pass===4?['fat-1']:[],summaries:[],nextToken:`token-${options.recordType}`}}}
    const service=new BodyService(repository,health,{} as BodyOcrPlugin,()=>new Date('2026-09-16T12:00:00Z'))
    await service.sync(); await service.sync()
    expect((await repository.measurements()).map((r)=>r.externalRecordId)).toEqual(['weight-1'])
    expect(calls.find((call)=>call.recordType==='Weight'&&call.changesToken)?.changesToken).toBe('token-Weight')
    expect((await db.query<{count:number}>('SELECT COUNT(*) AS count FROM health_sync_state'))[0]?.count).toBe(8)
    expect((await db.query<{count:number}>("SELECT COUNT(*) AS count FROM health_sync_state WHERE status='PERMISSION_MISSING'"))[0]?.count).toBe(6)
  })

  it('marks every type unavailable without blocking local Body data', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    const health:HealthConnectPlugin={availability:async()=>({status:'UNAVAILABLE'}),grantedPermissions:async()=>({recordTypes:[]}),
      requestHealthPermissions:async()=>({recordTypes:[]}),syncRecord:async()=>{throw new Error('must not run')}}
    const service=new BodyService(repository,health,{} as BodyOcrPlugin)
    await service.sync()
    expect((await db.query<{count:number}>("SELECT COUNT(*) AS count FROM health_sync_state WHERE status='UNAVAILABLE'"))[0]?.count).toBe(8)
    expect(await service.saveManual({measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',weightKg:65})).toMatchObject({weightKg:65})
  })

  it('recovers an expired per-type token with a bounded initial sync and preserves known summary values on null updates', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    await repository.setSyncState('Steps','SYNCED','expired',null)
    let attempts=0
    const health:HealthConnectPlugin={availability:async()=>({status:'AVAILABLE'}),grantedPermissions:async()=>({recordTypes:['Steps']}),
      requestHealthPermissions:async()=>({recordTypes:['Steps']}),syncRecord:async(options)=>{attempts++
        if(options.changesToken)return {upserts:[],deletions:[],summaries:[],nextToken:null,tokenExpired:true}
        return {upserts:[],deletions:[],summaries:[{localDate:'2026-09-16',steps:0,activeCaloriesKcal:null,
          exerciseMinutes:null,sleepMinutes:null,restingHeartRate:null,averageHeartRate:null,
          sourceSummaryJson:'{"recordTypes":{"Steps":true}}',lastSyncedAt:'2026-09-16T12:00:00Z'}],nextToken:'fresh'}}}
    const service=new BodyService(repository,health,{} as BodyOcrPlugin,()=>new Date('2026-09-16T12:00:00Z'))
    await service.sync(); expect(attempts).toBe(2); expect(await repository.summary('2026-09-16')).toMatchObject({steps:0})
    await repository.upsertSummary({localDate:'2026-09-16',steps:null,activeCaloriesKcal:200,exerciseMinutes:null,
      sleepMinutes:null,restingHeartRate:null,averageHeartRate:null,sourceSummaryJson:'{"recordTypes":{"ActiveCalories":true}}',lastSyncedAt:'later'})
    expect(await repository.summary('2026-09-16')).toMatchObject({steps:0,activeCaloriesKcal:200})
  })

  it('bounds expired-token recovery to that record type while another type remains incremental', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    await repository.setSyncState('Steps','SYNCED','expired-steps',null)
    await repository.setSyncState('BodyFat','SYNCED','body-fat-token',null)
    const calls:Array<{recordType:HealthRecordType;changesToken?:string}>=[]
    const health:HealthConnectPlugin={availability:async()=>({status:'AVAILABLE'}),
      grantedPermissions:async()=>({recordTypes:['Steps','BodyFat']}),requestHealthPermissions:async({recordTypes})=>({recordTypes}),
      syncRecord:async(options)=>{calls.push(options)
        if(options.recordType==='Steps'&&options.changesToken)return {upserts:[],deletions:[],summaries:[],nextToken:null,tokenExpired:true}
        return {upserts:[],deletions:[],summaries:[],nextToken:`fresh-${options.recordType}`}}}
    await new BodyService(repository,health,{} as BodyOcrPlugin,()=>new Date('2026-09-16T12:00:00Z')).sync()
    expect(calls.filter((call)=>call.recordType==='Steps')).toHaveLength(2)
    expect(calls.filter((call)=>call.recordType==='BodyFat')).toEqual([
      expect.objectContaining({recordType:'BodyFat',changesToken:'body-fat-token'}),
    ])
    expect(await repository.syncToken('Steps')).toBe('fresh-Steps')
    expect(await repository.syncToken('BodyFat')).toBe('fresh-BodyFat')
  })

  it('applies a race-safe initial snapshot result atomically before persisting its final token', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db); let initial=true
    const health:HealthConnectPlugin={availability:async()=>({status:'AVAILABLE'}),
      grantedPermissions:async()=>({recordTypes:['Weight']}),requestHealthPermissions:async({recordTypes})=>({recordTypes}),
      syncRecord:async(options)=>{
        expect(options.changesToken).toBeUndefined()
        let sourceValue=66
        const snapshotValue=sourceValue
        sourceValue=65.4 // Models a source mutation after the snapshot and before the token is drained.
        const result={upserts:[
          {externalRecordId:'raced',recordType:'Weight' as const,measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',value:snapshotValue,sourceApp:'fake'},
          {externalRecordId:'raced',recordType:'Weight' as const,measuredAt:'2026-09-16T08:01:00Z',localDate:'2026-09-16',value:sourceValue,sourceApp:'fake'},
        ],deletions:[],summaries:[],nextToken:'after-all-pages'}
        initial=false; return result
      }}
    await new BodyService(repository,health,{} as BodyOcrPlugin,()=>new Date('2026-09-16T12:00:00Z')).sync()
    expect(initial).toBe(false)
    expect(await repository.measurements()).toMatchObject([{externalRecordId:'raced',weightKg:65.4}])
    expect(await repository.syncToken('Weight')).toBe('after-all-pages')
  })

  it('does not advance a durable token when applying a sync result fails', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    await repository.setSyncState('Weight','SYNCED','durable',null)
    const health:HealthConnectPlugin={availability:async()=>({status:'AVAILABLE'}),
      grantedPermissions:async()=>({recordTypes:['Weight']}),requestHealthPermissions:async({recordTypes})=>({recordTypes}),
      syncRecord:async()=>({upserts:[{externalRecordId:'must-roll-back',recordType:'Weight',
        measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',value:65,sourceApp:'fake'}],
        deletions:[],summaries:[{localDate:'2026-09-16',steps:-1,
        activeCaloriesKcal:null,exerciseMinutes:null,sleepMinutes:null,restingHeartRate:null,averageHeartRate:null,
        sourceSummaryJson:'{}',lastSyncedAt:'now'}],nextToken:'must-not-persist'})}
    await new BodyService(repository,health,{} as BodyOcrPlugin,()=>new Date('2026-09-16T12:00:00Z')).sync()
    expect(await repository.syncToken('Weight')).toBe('durable')
    expect(await repository.measurements()).toEqual([])
    expect(await db.query("SELECT status FROM health_sync_state WHERE record_type='Weight'"))
      .toEqual([{status:'ERROR'}])
  })

  it('does not apply non-body deletion IDs to Health Connect body mirrors', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    const mirrored=await repository.upsertHealth({measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',weightKg:65,
      externalRecordId:'shared-id',sourceApp:'fake'})
    const health:HealthConnectPlugin={availability:async()=>({status:'AVAILABLE'}),
      grantedPermissions:async()=>({recordTypes:['Steps']}),requestHealthPermissions:async({recordTypes})=>({recordTypes}),
      syncRecord:async()=>({upserts:[],deletions:['shared-id'],summaries:[],nextToken:'steps-token'})}
    await new BodyService(repository,health,{} as BodyOcrPlugin,()=>new Date('2026-09-16T12:00:00Z')).sync()
    expect(await repository.measurement(mirrored.id)).not.toBeNull()
  })

  it('retains per-type tokens through revocation and preserves saved summary zones across device-zone changes', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    await repository.setSyncState('Weight','SYNCED','weight-token',null)
    await repository.upsertSummary({localDate:'2026-09-15',steps:10,activeCaloriesKcal:null,
      exerciseMinutes:null,sleepMinutes:null,restingHeartRate:null,averageHeartRate:null,
      sourceSummaryJson:'{"recordTypes":{"Steps":true},"zoneId":"Europe/Stockholm"}',lastSyncedAt:'now'})
    let captured: Parameters<HealthConnectPlugin['syncRecord']>[0] | null=null
    const health:HealthConnectPlugin={availability:async()=>({status:'AVAILABLE'}),
      grantedPermissions:async()=>({recordTypes:['Steps']}),requestHealthPermissions:async({recordTypes})=>({recordTypes}),
      syncRecord:async(options)=>{captured=options; return {upserts:[],deletions:[],summaries:[],nextToken:'steps-token'}}}
    await new BodyService(repository,health,{} as BodyOcrPlugin,()=>new Date('2026-09-16T12:00:00Z'),
      ()=>'America/New_York').sync()
    expect(await repository.syncToken('Weight')).toBe('weight-token')
    expect(await repository.summary('2026-09-15')).toMatchObject({steps:10})
    expect(captured).toMatchObject({recordType:'Steps',zoneId:'America/New_York',
      summaryZones:{'2026-09-15':'Europe/Stockholm'}})
  })

  it('round-trips null and real zero independently for all six daily summary metrics', async () => {
    const {db}=await ready(); const repository=new BodyRepository(db)
    await repository.upsertSummary({localDate:'2026-09-16',steps:0,activeCaloriesKcal:0,exerciseMinutes:0,
      sleepMinutes:0,restingHeartRate:null,averageHeartRate:null,sourceSummaryJson:'{}',lastSyncedAt:'zero'})
    expect(await repository.summary('2026-09-16')).toMatchObject({steps:0,activeCaloriesKcal:0,
      exerciseMinutes:0,sleepMinutes:0,restingHeartRate:null,averageHeartRate:null})
    await repository.upsertSummary({localDate:'2026-09-17',steps:null,activeCaloriesKcal:null,exerciseMinutes:null,
      sleepMinutes:null,restingHeartRate:0,averageHeartRate:0,sourceSummaryJson:'{}',lastSyncedAt:'zero'})
    expect(await repository.summary('2026-09-17')).toMatchObject({steps:null,activeCaloriesKcal:null,
      exerciseMinutes:null,sleepMinutes:null,restingHeartRate:0,averageHeartRate:0})
    await repository.upsertSummary({localDate:'2026-09-16',steps:null,activeCaloriesKcal:null,exerciseMinutes:null,
      sleepMinutes:null,restingHeartRate:null,averageHeartRate:null,sourceSummaryJson:'{}',lastSyncedAt:'cleared'},
    undefined,'Steps')
    expect(await repository.summary('2026-09-16')).toMatchObject({steps:null,activeCaloriesKcal:0,
      exerciseMinutes:0,sleepMinutes:0})
  })

  it('never mutates saved nutrition snapshots while future resolution can use a newer imported weight', async () => {
    const {db}=await ready(); const body=new BodyRepository(db); const nutrition=new NutritionRepository(db)
    await db.run(`INSERT INTO daily_nutrition_targets (id,local_date,calories_min,calories_max,protein_min_g,
      protein_max_g,nutrition_plan_run_id,day_type,calculation_version,rationale_json,created_at)
      VALUES ('saved','2026-09-15',1400,1650,90,105,NULL,'NORMAL','M8','{"weight":70}','now')`)
    const before=await db.query("SELECT * FROM daily_nutrition_targets WHERE id='saved'")
    await body.upsertHealth({measuredAt:'2026-09-16T08:00:00Z',localDate:'2026-09-16',weightKg:66,
      externalRecordId:'new-weight',sourceApp:'fake'})
    await body.insert({measuredAt:'2026-08-01T08:00:00Z',localDate:'2026-08-01',sourceType:'SCREENSHOT_OCR',
      weightKg:72,userVerified:true})
    expect(await db.query("SELECT * FROM daily_nutrition_targets WHERE id='saved'")).toEqual(before)
    expect(await nutrition.latestWeightOnOrBefore('2026-09-17')).toMatchObject({external_record_id:'new-weight',weight_kg:66})
  })
})
