-- Membership changes refresh the affected user's JWT.
CREATE OR REPLACE FUNCTION bump_user_jwt_invalidated_at() RETURNS trigger AS $$
BEGIN
  UPDATE "users" SET "jwtInvalidatedAt" = NOW()
  WHERE "id" = COALESCE(NEW."userId", OLD."userId");
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS memberships_bump_jwt ON "memberships";
CREATE TRIGGER memberships_bump_jwt
AFTER INSERT OR UPDATE OR DELETE ON "memberships"
FOR EACH ROW EXECUTE FUNCTION bump_user_jwt_invalidated_at();

-- One VERIFIED claim per domain (relied on by domain-verification-service).
CREATE UNIQUE INDEX IF NOT EXISTS "organization_domains_domain_verified_key"
  ON "organization_domains" ("domain") WHERE "status" = 'VERIFIED';

-- Constraints/indexes from the legacy hand-run SQL that Prisma cannot express.
ALTER TABLE "metrc_facilities" DROP CONSTRAINT IF EXISTS "metrc_facilities_metrcEnvironment_check";
ALTER TABLE "metrc_facilities" ADD CONSTRAINT "metrc_facilities_metrcEnvironment_check"
  CHECK ("metrcEnvironment" IN ('mock', 'sandbox', 'production'));

ALTER TABLE "metrc_facilities" DROP CONSTRAINT IF EXISTS "chk_facility_type";
ALTER TABLE "metrc_facilities" ADD CONSTRAINT "chk_facility_type"
  CHECK ("facilityType" IS NULL OR "facilityType" IN (
    'Cultivator','Manufacturer','Dispensary','Testing Lab','Distributor',
    'Transporter','Storage','Operator','Microbusiness','Other'));

ALTER TABLE "bills_of_material" DROP CONSTRAINT IF EXISTS "chk_bom_component_ref";
ALTER TABLE "bills_of_material" ADD CONSTRAINT "chk_bom_component_ref"
  CHECK ("componentItemId" IS NOT NULL OR "componentMetrcItemName" IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_bom_metrc_component"
  ON "bills_of_material" ("facilityId", "metrcItemName", "componentMetrcItemName")
  WHERE "componentMetrcItemName" IS NOT NULL;
