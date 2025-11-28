-- quizzes テーブルとサンプルデータ（実行: psql -d ncoin_database -f migrations/quizzes.sql も可）

CREATE TABLE IF NOT EXISTS quizzes (
  quiz_id TEXT PRIMARY KEY,
  title TEXT,
  data JSONB,
  reward INTEGER DEFAULT 100,
  is_ex BOOLEAN DEFAULT FALSE
);

INSERT INTO quizzes (quiz_id, title, data, reward, is_ex) VALUES
('quiz01', 'Quiz 01', '{"questions":[{"text":"2 + 2 = ?","choices":["1","2","3","4"],"answer":3}], "type":"single"}', 100, false)
ON CONFLICT (quiz_id) DO NOTHING;

INSERT INTO quizzes (quiz_id, title, data, reward, is_ex) VALUES
('quiz02', 'Quiz 02', '{"questions":[{"text":"Capital of France?","choices":["Berlin","London","Paris","Rome"],"answer":2}], "type":"single"}', 100, false)
ON CONFLICT (quiz_id) DO NOTHING;

INSERT INTO quizzes (quiz_id, title, data, reward, is_ex) VALUES
('quiz03', 'Quiz 03', '{"questions":[{"text":"5 * 3 = ?","choices":["8","15","12","20"],"answer":1}], "type":"single"}', 100, false)
ON CONFLICT (quiz_id) DO NOTHING;

INSERT INTO quizzes (quiz_id, title, data, reward, is_ex) VALUES
('quiz04', 'Quiz 04', '{"questions":[{"text":"Which is a mammal?","choices":["Shark","Dolphin","Octopus","Trout"],"answer":1}], "type":"single"}', 100, false)
ON CONFLICT (quiz_id) DO NOTHING;

INSERT INTO quizzes (quiz_id, title, data, reward, is_ex) VALUES
('quiz05', 'Quiz 05', '{"questions":[{"text":"Sun rises in the?","choices":["West","East"],"answer":1}], "type":"single"}', 100, false)
ON CONFLICT (quiz_id) DO NOTHING;