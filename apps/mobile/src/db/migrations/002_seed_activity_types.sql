INSERT INTO activity_types (id, system_key, name, is_system, is_active) VALUES
('0851d3af-fde4-5a5c-b004-3e6a27924372','LOW_IMPACT_CARDIO','Low-impact cardio',1,1),
('f94117ad-0e6f-5577-a181-ccbae9d7b65d','CARDIO','Cardio',1,1),
('de3821a2-9005-5fea-9be6-f0b030983520','AEROBICS','Aerobics',1,1),
('5d2bf57c-4a9a-59ac-823a-f9b9dbfa1853','DANCE_CARDIO','Dance cardio',1,1),
('2efdf1a2-2074-5b89-84b2-ccf41c93c477','BODYWEIGHT_STRENGTH','Bodyweight strength',1,1),
('3c5f80e4-8ac8-5507-af76-aeb934a2508d','CORE','Core',1,1),
('bc803d3e-c8e1-5041-bb38-905544537fa8','PILATES','Pilates',1,1),
('a8afc138-e168-52a5-b3d5-ec96216798d3','YOGA','Yoga',1,1),
('cbd4cb59-53cb-572e-8d99-8ad84ad8c299','STRETCH_MOBILITY','Stretch and mobility',1,1),
('151be9de-fff7-5e75-a744-222ae2c9f0dc','RECOVERY','Recovery',1,1),
('626e4d72-da9b-5a49-bd04-db42fcefd9a1','WALKING','Walking',1,1),
('c24aaceb-f8c5-5e1f-9bd4-7716e93bde9a','RUNNING','Running',1,1),
('9bb4a495-fc5e-5915-861d-83dab6d1fb83','CYCLING','Cycling',1,1),
('7ea0e92d-d4fc-5e97-ba44-ec9a25be9434','OUTDOOR','Outdoor',1,1),
('a2633b40-1685-5f23-876c-6daf1c162aa6','OTHER','Other',1,1),
('a6ee77ce-84ce-540d-8997-d3102771fda2','COMBAT_CARDIO','Combat cardio',1,1),
('56a7fdd6-5b69-523a-b1fa-1c7b77bff751','SWIMMING','Swimming',1,1),
('42b9d44a-bfe7-522b-9756-9aaf004e828d','BALL_RECREATIONAL','Ball and recreational sport',1,1),
('f18b3f54-22a1-5c64-97d5-0ca39441af7b','MARTIAL_ARTS','Martial arts',1,1);
INSERT INTO activity_preferences (id, activity_type_id, explicit_preference, inferred_score)
SELECT CASE system_key
  WHEN 'COMBAT_CARDIO' THEN 'edcf20d1-fcf0-5234-a5f2-5791a368e9a4'
  WHEN 'SWIMMING' THEN '9ed834e8-d746-55f1-b045-543e65e6ab4d'
  WHEN 'BALL_RECREATIONAL' THEN '5e8913bb-214a-5ec7-934d-845eb0be7978'
  WHEN 'MARTIAL_ARTS' THEN 'c2a8d07d-0683-58a6-b445-6a196278d876'
END, id, 'NEUTRAL', -0.5 FROM activity_types
WHERE system_key IN ('COMBAT_CARDIO','SWIMMING','BALL_RECREATIONAL','MARTIAL_ARTS');
INSERT INTO app_preference (singleton_key) VALUES (1);
INSERT INTO streak_state (singleton_key, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
