UPDATE app_preference SET locale = 'zh-CN'
WHERE singleton_key = 1 AND locale = 'en';

UPDATE activity_types SET name = CASE system_key
  WHEN 'LOW_IMPACT_CARDIO' THEN '低冲击有氧'
  WHEN 'CARDIO' THEN '有氧运动'
  WHEN 'AEROBICS' THEN '健美操'
  WHEN 'DANCE_CARDIO' THEN '有氧舞蹈'
  WHEN 'BODYWEIGHT_STRENGTH' THEN '自重力量'
  WHEN 'CORE' THEN '核心训练'
  WHEN 'PILATES' THEN '普拉提'
  WHEN 'YOGA' THEN '瑜伽'
  WHEN 'STRETCH_MOBILITY' THEN '拉伸与灵活性'
  WHEN 'RECOVERY' THEN '恢复训练'
  WHEN 'WALKING' THEN '步行'
  WHEN 'RUNNING' THEN '跑步'
  WHEN 'CYCLING' THEN '骑行'
  WHEN 'OUTDOOR' THEN '户外运动'
  WHEN 'OTHER' THEN '其他'
  WHEN 'COMBAT_CARDIO' THEN '搏击有氧'
  WHEN 'SWIMMING' THEN '游泳'
  WHEN 'BALL_RECREATIONAL' THEN '球类与休闲运动'
  WHEN 'MARTIAL_ARTS' THEN '武术与格斗'
  ELSE name END
WHERE is_system = 1;
