resource "aws_kms_key" "main" {
  description         = "Grodivo sales data (RDS, secrets, S3)"
  enable_key_rotation = true
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}

resource "random_password" "db" {
  length           = 40
  special          = true
  override_special = "-_"
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
}

resource "aws_db_instance" "main" {
  identifier                  = "${local.name}-db"
  engine                      = "postgres"
  engine_version              = "16"
  auto_minor_version_upgrade  = true
  instance_class              = var.db_instance_class
  allocated_storage           = 20
  max_allocated_storage       = 100
  storage_type                = "gp3"
  storage_encrypted           = true
  kms_key_id                  = aws_kms_key.main.arn
  db_name                     = "grodivo"
  username                    = "grodivo_admin"
  password                    = random_password.db.result
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.db.id]
  parameter_group_name        = aws_db_parameter_group.pg16.name
  publicly_accessible         = false
  multi_az                    = false
  backup_retention_period     = 14
  backup_window               = "07:00-08:00"
  maintenance_window          = "sun:08:30-sun:09:30"
  copy_tags_to_snapshot       = true
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${local.name}-db-final"
  enabled_cloudwatch_logs_exports = ["postgresql"]

  lifecycle {
    ignore_changes = [engine_version]
  }
}

# Kept for break-glass access and future rotation; Lambdas receive the URL via encrypted env vars.
resource "aws_secretsmanager_secret" "db" {
  name       = "${local.name}/database"
  kms_key_id = aws_kms_key.main.arn
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = aws_db_instance.main.db_name
    username = aws_db_instance.main.username
    password = random_password.db.result
  })
}

locals {
  database_url = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}"
}
