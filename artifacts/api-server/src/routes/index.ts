import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sanfaaniRouter from "./sanfaani";
import { requireUser } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireUser);
router.use(sanfaaniRouter);

export default router;
