-- Create the database for the citizen scheduler application
-- Run this SQL script before running create_tables.py

CREATE DATABASE mla_scheduler_v1
    WITH 
    OWNER = postgres
    ENCODING = 'UTF8'
    LC_COLLATE = 'English_United States.1252'
    LC_CTYPE = 'English_United States.1252'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1;

COMMENT ON DATABASE mla_scheduler_v1 IS 'Citizen scheduler application database';
