import express from "express";
import cors from "cors";
import "./db.js";
import { authRouter } from "./routes/authRoutes.js";
import { listRouter } from "./routes/listRoutes.js";
import { tagRouter } from "./routes/tagRoutes.js";
import { taskRouter } from "./routes/taskRoutes.js";
import { habitRouter } from "./routes/habitRoutes.js";

if (!process.env.JWT_SECRET) {
  console.warn(
    "[warn] JWT_SECRET is not set — using an insecure default. Set JWT_SECRET before deploying."
  );
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/lists", listRouter);
app.use("/api/tags", tagRouter);
app.use("/api/tasks", taskRouter);
app.use("/api/habits", habitRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
