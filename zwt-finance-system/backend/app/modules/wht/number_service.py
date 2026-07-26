from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.wht.models import IssueCounter, WhtTask
from app.modules.wht.numbering import build_normal_number, build_supplement_number


async def assign_number_on_approval(
    session: AsyncSession,
    task: WhtTask,
) -> WhtTask:
    """Allocate a unique formal number while holding the counter row lock.

    The caller must execute this function inside the same transaction that
    changes the task to ``approved``. Database unique constraints remain the
    final guard against duplicate task numbers.
    """

    if task.task_no is not None:
        return task
    if task.status not in {"pending_review", "draft"}:
        raise ValueError("only a draft or pending-review task can be approved")

    supplement_run = task.supplement_run if task.issuance_type == "supplement" else 0
    counter_query = (
        select(IssueCounter)
        .where(
            IssueCounter.period == task.period,
            IssueCounter.issue_type == task.issuance_type,
            IssueCounter.supplement_run == supplement_run,
        )
        .with_for_update()
    )
    counter = await session.scalar(counter_query)
    if counter is None:
        create_counter = (
            insert(IssueCounter)
            .values(
                period=task.period,
                issue_type=task.issuance_type,
                supplement_run=supplement_run,
                next_sequence=1,
            )
            .on_conflict_do_nothing(
                constraint="uq_wht_issue_counter_scope",
            )
        )
        await session.execute(create_counter)
        counter = await session.scalar(counter_query)
        if counter is None:
            raise RuntimeError("failed to create or lock WHT issue counter")

    if task.issuance_type == "normal":
        number = build_normal_number(task.period, counter.next_sequence)
    else:
        number = build_supplement_number(
            task.period,
            task.supplement_run,
            counter.next_sequence,
        )

    task.task_no = number.task_no
    task.book_no = number.book_no
    task.status = "approved"
    counter.next_sequence += 1
    await session.flush()
    return task
