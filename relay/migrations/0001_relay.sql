CREATE TABLE IF NOT EXISTS relay_batches (
  tag TEXT NOT NULL,
  digest TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY(tag,digest)
);
CREATE INDEX IF NOT EXISTS relay_batches_day ON relay_batches(tag,day);
