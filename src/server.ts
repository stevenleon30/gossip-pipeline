import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { runPipeline } from "./index.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/output", express.static("output"));

app.post("/api/generate", async (req, res) => {
  const { product } = req.body;

  if (!product) {
    return res.status(400).json({ error: "Missing product name or URL" });
  }

  try {
    const result = await runPipeline(product);

    // Format clip and voiceover paths as web-accessible URL paths (/output/clip-01.mp4, /output/voiceover-01.mp3)
    const clipUrls = result.clips.map((clipPath) => {
      const filename = path.basename(clipPath);
      return `/output/${filename}`;
    });

    const voiceoverUrls = (result.voiceovers || []).map((voPath) => {
      const filename = path.basename(voPath);
      return `/output/${filename}`;
    });

    res.json({ ...result, clips: clipUrls, voiceovers: voiceoverUrls });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Pipeline failed. Check server logs." });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
