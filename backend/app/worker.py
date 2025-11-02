from __future__ import annotations

from rq import Worker
from backend.app.queue import get_connection, RQ_QUEUE_NAME  # redis conn + queue name
# Import the task so the worker process knows how to execute it
from backend.app.tasks import process_stub  # noqa: F401  (imported for side-effect)

from dotenv import load_dotenv
load_dotenv()


def main() -> None:
    conn = get_connection()
    # Listen only to our queue name
    worker = Worker(queues=[RQ_QUEUE_NAME], connection=conn)
    worker.work(with_scheduler=True)

if __name__ == "__main__":
    main()
