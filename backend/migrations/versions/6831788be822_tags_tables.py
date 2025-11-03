"""tags tables

Revision ID: 6831788be822
Revises: b96b354190a3
Create Date: 2025-11-02 22:08:02.892262
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "6831788be822"
down_revision = "b96b354190a3"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "tag",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "upload_tag",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("upload_id", sa.String(length=36), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["upload_id"], ["upload.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tag.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("upload_id", "tag_id", name="uq_upload_tag_upload_id_tag_id"),
    )
    op.create_index("ix_tag_name", "tag", ["name"], unique=True)
    op.create_index("ix_upload_tag_upload_id", "upload_tag", ["upload_id"], unique=False)
    op.create_index("ix_upload_tag_tag_id", "upload_tag", ["tag_id"], unique=False)

def downgrade() -> None:
    op.drop_index("ix_upload_tag_tag_id", table_name="upload_tag")
    op.drop_index("ix_upload_tag_upload_id", table_name="upload_tag")
    op.drop_index("ix_tag_name", table_name="tag")
    op.drop_table("upload_tag")
    op.drop_table("tag")
