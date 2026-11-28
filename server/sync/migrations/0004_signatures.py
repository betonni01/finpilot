from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("sync", "0003_sharedboard"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="sharedboard",
            name="owner_seat",
            field=models.CharField(default="organizer", max_length=40),
        ),
        migrations.CreateModel(
            name="BoardClaim",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("seat", models.CharField(max_length=64)),
                ("board", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="claims", to="sync.sharedboard")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="board_claims", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("board", "user"), name="one_claim_user"),
                    models.UniqueConstraint(fields=("board", "seat"), name="one_claim_seat"),
                ],
            },
        ),
        migrations.CreateModel(
            name="BoardWatch",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("board", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="watches", to="sync.sharedboard")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="board_watches", to=settings.AUTH_USER_MODEL)),
            ],
            options={"constraints": [models.UniqueConstraint(fields=("board", "user"), name="one_watch")]},
        ),
        migrations.CreateModel(
            name="BoardSignature",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("kind", models.CharField(max_length=16)),
                ("ref", models.CharField(max_length=160)),
                ("role", models.CharField(max_length=16)),
                ("digest", models.CharField(max_length=64)),
                ("signed_at", models.DateTimeField(auto_now=True)),
                ("board", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="signatures", to="sync.sharedboard")),
                ("signer", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="board_signatures", to=settings.AUTH_USER_MODEL)),
            ],
            options={"constraints": [models.UniqueConstraint(fields=("board", "ref", "role"), name="one_signature")]},
        ),
        migrations.CreateModel(
            name="Notice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("board_id", models.CharField(max_length=64)),
                ("title", models.CharField(max_length=120)),
                ("body", models.CharField(max_length=300)),
                ("path", models.CharField(max_length=40)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="notices", to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
