-- Clear the duplicates the onboarding loop created, and point recovery at the
-- address the owner actually signs in with.
--
-- Two things had to be corrected. 0020 guessed the owner's address from the
-- dead development Clerk account; the owner signs in with a different one.
-- And the loop had by then produced two empty companies, one per attempt.
-- Those matter more than they look: resolveCaller checks owned companies
-- before anything else, so an account that owns an empty company never reaches
-- the recovery path at all — it just lands in the empty one, forever. The real
-- company stays unreachable no matter how good the recovery logic is.
--
-- Every statement is guarded so it cannot touch anything but the records
-- described here, and is a no-op in any database where those records are
-- absent — including development, where the owner account is alive and the
-- duplicates never existed.

-- The address the owner signs in with, replacing the guess from 0020. This
-- still grants nothing on its own: re-attaching requires the address to be
-- verified with Clerk AND the stored owner account to come back 404.
UPDATE "companies"
SET "owner_email" = 'cleaningserviceyeg@gmail.com',
    "owner_recovery_until" = now() + interval '90 days'
WHERE "owner_user_id" = 'user_3HW5ccKqERUiiU32Mkpv9KTWjcA';

-- The empty duplicates, and their children first so no foreign key is left
-- dangling. The guard is repeated verbatim on each statement rather than
-- collected once into a data-modifying CTE, where the ordering between the
-- child and parent deletes would not be guaranteed.
--
-- "Empty" is defined strictly: no bookings, no calls, and no team member who
-- has ever signed in — only the placeholder seat every new company is created
-- with. Deleting those placeholders does not weaken the guard for the
-- statements that follow, since it only ever tests for *real* members. A
-- company with any genuine content in it will not match and is left alone.
DELETE FROM "activity" WHERE "company_id" IN (
  SELECT c."id" FROM "companies" c
  WHERE c."owner_user_id" IN ('user_3HW7oKOVVPPUX1aEW7XeCxRWfX4', 'user_3HWRMQy3sMmshdiliMsuCqpaisp')
    AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "calls" k WHERE k."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "team_members" t WHERE t."company_id" = c."id"
      AND (t."clerk_user_id" IS NOT NULL OR t."email" <> 'owner@company.com'))
);

DELETE FROM "services" WHERE "company_id" IN (
  SELECT c."id" FROM "companies" c
  WHERE c."owner_user_id" IN ('user_3HW7oKOVVPPUX1aEW7XeCxRWfX4', 'user_3HWRMQy3sMmshdiliMsuCqpaisp')
    AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "calls" k WHERE k."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "team_members" t WHERE t."company_id" = c."id"
      AND (t."clerk_user_id" IS NOT NULL OR t."email" <> 'owner@company.com'))
);

DELETE FROM "quo_webhooks" WHERE "company_id" IN (
  SELECT c."id" FROM "companies" c
  WHERE c."owner_user_id" IN ('user_3HW7oKOVVPPUX1aEW7XeCxRWfX4', 'user_3HWRMQy3sMmshdiliMsuCqpaisp')
    AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "calls" k WHERE k."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "team_members" t WHERE t."company_id" = c."id"
      AND (t."clerk_user_id" IS NOT NULL OR t."email" <> 'owner@company.com'))
);

DELETE FROM "homeowner_pins" WHERE "company_id" IN (
  SELECT c."id" FROM "companies" c
  WHERE c."owner_user_id" IN ('user_3HW7oKOVVPPUX1aEW7XeCxRWfX4', 'user_3HWRMQy3sMmshdiliMsuCqpaisp')
    AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "calls" k WHERE k."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "team_members" t WHERE t."company_id" = c."id"
      AND (t."clerk_user_id" IS NOT NULL OR t."email" <> 'owner@company.com'))
);

DELETE FROM "cleaner_locations" WHERE "company_id" IN (
  SELECT c."id" FROM "companies" c
  WHERE c."owner_user_id" IN ('user_3HW7oKOVVPPUX1aEW7XeCxRWfX4', 'user_3HWRMQy3sMmshdiliMsuCqpaisp')
    AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "calls" k WHERE k."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "team_members" t WHERE t."company_id" = c."id"
      AND (t."clerk_user_id" IS NOT NULL OR t."email" <> 'owner@company.com'))
);

DELETE FROM "team_members" WHERE "company_id" IN (
  SELECT c."id" FROM "companies" c
  WHERE c."owner_user_id" IN ('user_3HW7oKOVVPPUX1aEW7XeCxRWfX4', 'user_3HWRMQy3sMmshdiliMsuCqpaisp')
    AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "calls" k WHERE k."company_id" = c."id")
    AND NOT EXISTS (SELECT 1 FROM "team_members" t WHERE t."company_id" = c."id"
      AND (t."clerk_user_id" IS NOT NULL OR t."email" <> 'owner@company.com'))
);

DELETE FROM "companies" c
WHERE c."owner_user_id" IN ('user_3HW7oKOVVPPUX1aEW7XeCxRWfX4', 'user_3HWRMQy3sMmshdiliMsuCqpaisp')
  AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."company_id" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "calls" k WHERE k."company_id" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "team_members" t WHERE t."company_id" = c."id");
