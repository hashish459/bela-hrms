/**
 * Break-glass recovery: promote a login to system administrator.
 *
 * The situation this exists for is not hypothetical. Roles are editable, and the
 * editor is reachable only by somebody who already holds the permission to edit
 * them — so removing the administrator role from the last administrator leaves a
 * state the product cannot leave from the inside. No amount of care in the UI
 * closes that hole; there has to be a door outside it.
 *
 * This is that door, and it is deliberately at the console: running it requires
 * shell access to the machine and the database credentials, which is a person
 * who has already proved they own the system.
 *
 * A system administrator holds every permission whatever roles they are given,
 * so the account cannot be locked out again by a role edit.
 *
 *   pnpm admin:unlock                        # list accounts and their status
 *   pnpm admin:unlock admin@bela.example.np  # promote that login
 *   pnpm admin:unlock --revoke someone@x.np  # take it away again
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, organizations, userAccounts } from "@/db/schema/core";
import { user } from "@/db/schema/auth";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"))?.toLowerCase();

  const accounts = await db
    .select({
      userId: userAccounts.userId,
      email: user.email,
      name: user.name,
      isActive: userAccounts.isActive,
      isSystemAdmin: userAccounts.isSystemAdmin,
      orgId: userAccounts.orgId,
      orgName: organizations.name,
    })
    .from(userAccounts)
    .innerJoin(user, eq(user.id, userAccounts.userId))
    .innerJoin(organizations, eq(organizations.id, userAccounts.orgId))
    .orderBy(user.email);

  if (!email) {
    console.log("\nAccounts\n");
    for (const a of accounts) {
      const flags = [
        a.isSystemAdmin ? "SYSTEM ADMIN" : "",
        a.isActive ? "" : "disabled",
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`  ${a.email.padEnd(38)} ${a.name.padEnd(24)} ${flags}`);
    }
    console.log(
      `\n${accounts.filter((a) => a.isSystemAdmin).length} system administrator(s).` +
        "\nPass an email address to promote one:  pnpm admin:unlock <email>\n",
    );
    process.exit(0);
  }

  const target = accounts.find((a) => a.email.toLowerCase() === email);
  if (!target) {
    console.error(`\nNo account for ${email}. Run without arguments to list them.\n`);
    process.exit(1);
  }

  // Refuse to remove the last one — the whole point is that this state is always
  // escapable, and revoking the only holder would recreate the lockout.
  if (revoke) {
    const holders = accounts.filter((a) => a.isSystemAdmin);
    if (holders.length <= 1 && target.isSystemAdmin) {
      console.error(
        `\n${target.email} is the only system administrator. Promote another account first,` +
          " otherwise a role edit could lock this database out again.\n",
      );
      process.exit(1);
    }
  }

  await db
    .update(userAccounts)
    .set({ isSystemAdmin: !revoke })
    .where(eq(userAccounts.userId, target.userId));

  await db.insert(auditLog).values({
    orgId: target.orgId,
    actorUserId: null,
    actorLabel: "console (pnpm admin:unlock)",
    action: "update",
    entityType: "user_account",
    entityId: null,
    summary: `${revoke ? "Revoked" : "Granted"} system administrator for ${target.email}`,
  });

  console.log(
    `\n${revoke ? "Revoked" : "Granted"} system administrator: ${target.email} (${target.orgName})\n` +
      (revoke
        ? ""
        : "They now hold every permission regardless of their roles, and can view the product as any role from the header.\n"),
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
