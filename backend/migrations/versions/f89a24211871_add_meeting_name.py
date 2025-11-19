"""add meeting.name

Revision ID: add_meeting_name
Revises: 6831788be822
Create Date: 2025-11-17
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "add_meeting_name"
down_revision = "6831788be822"  # <- your last rev id
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meeting", sa.Column("name", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("meeting", "name")

