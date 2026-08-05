import { Router, type IRouter } from "express";
import healthRouter from "./health";
import companyRouter from "./company";
import phoneRouter from "./phone";
import servicesRouter from "./services";
import teamRouter from "./team";
import callsRouter from "./calls";
import bookingsRouter from "./bookings";
import dashboardRouter from "./dashboard";
// Note: the Quo webhook receiver is mounted in app.ts ahead of the JSON body
// parser so it can verify signatures against the raw request bytes.

const router: IRouter = Router();

router.use(healthRouter);
router.use(companyRouter);
router.use(phoneRouter);
router.use(servicesRouter);
router.use(teamRouter);
router.use(callsRouter);
router.use(bookingsRouter);
router.use(dashboardRouter);

export default router;
