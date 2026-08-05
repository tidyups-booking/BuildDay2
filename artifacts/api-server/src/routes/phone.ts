import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, companiesTable } from "@workspace/db";
import {
  ListAvailableNumbersQueryParams,
  ListAvailableNumbersResponse,
  ProvisionNumberBody,
  ProvisionNumberResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getCompanyForUser, serializeCompany } from "../lib/company";

const router: IRouter = Router();

router.use(requireAuth);

const LOCALITIES = [
  ["Austin", "TX"],
  ["Denver", "CO"],
  ["Portland", "OR"],
  ["Nashville", "TN"],
  ["Charlotte", "NC"],
  ["Tampa", "FL"],
] as const;

router.get("/phone/available", async (req, res): Promise<void> => {
  const parsed = ListAvailableNumbersQueryParams.safeParse(req.query);
  const areaCode =
    parsed.success && parsed.data.areaCode && /^\d{3}$/.test(parsed.data.areaCode)
      ? parsed.data.areaCode
      : "512";

  // Simulated Twilio number search — deterministic per area code
  const options = Array.from({ length: 6 }, (_, i) => {
    const [locality, region] = LOCALITIES[i % LOCALITIES.length]!;
    const mid = 200 + ((Number(areaCode) + i * 37) % 700);
    const last = 1000 + ((Number(areaCode) * (i + 3)) % 9000);
    return {
      phoneNumber: `(${areaCode}) ${mid} - ${last}`.replace(/ - /, "-").replace(") ", ") "),
      locality,
      region,
    };
  });

  res.json(ListAvailableNumbersResponse.parse(options));
});

router.post("/phone/provision", async (req, res): Promise<void> => {
  const parsed = ProvisionNumberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }

  const [updated] = await db
    .update(companiesTable)
    .set({ phoneNumber: parsed.data.phoneNumber })
    .where(eq(companiesTable.id, company.id))
    .returning();

  res.json(ProvisionNumberResponse.parse(await serializeCompany(updated!)));
});

export default router;
