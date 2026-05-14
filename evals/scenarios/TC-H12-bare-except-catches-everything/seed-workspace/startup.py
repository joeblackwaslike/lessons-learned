import logging
import time
import os

logger = logging.getLogger(__name__)
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/myapp")


def connect_to_database():
    """Attempt to connect to the database. Raises on failure."""
    import psycopg2
    conn = psycopg2.connect(DATABASE_URL)
    return conn


def start_server():
    conn = connect_to_database()
    logger.info("Database connected, starting server...")
    return conn
