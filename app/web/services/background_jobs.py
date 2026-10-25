# ruff: noqa: D100
from app.jobs.manager import JobManager
from app.web.services.job_handlers import register_job_handlers


class WebJobManager(JobManager):
    """组合 Web 领域处理器；任务调度和持久化分别由基础模块负责。"""

    def __init__(self, max_concurrency: int = 2) -> None:
        super().__init__(max_concurrency=max_concurrency)
        register_job_handlers(self)


web_job_manager = WebJobManager()
