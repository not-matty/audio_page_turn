import { spawn } from "child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MUSICXML_EXTS = [".musicxml", ".mxl", ".xml"];

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const parseArgs = (value: string | undefined) =>
  (value ?? "")
    .split(" ")
    .map((arg) => arg.trim())
    .filter(Boolean);

const runCommand = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout: NodeJS.Timeout | null = null;

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout, stderr, timedOut });
    });
  });

const findMusicXmlFile = async (rootDir: string) => {
  const candidates: string[] = [];
  const queue = [rootDir];

  while (queue.length) {
    const current = queue.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (MUSICXML_EXTS.includes(ext)) {
        candidates.push(fullPath);
      }
    }
  }

  for (const ext of MUSICXML_EXTS) {
    const match = candidates.find((candidate) => candidate.endsWith(ext));
    if (match) return match;
  }
  return null;
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No file provided for OMR." },
      { status: 400 }
    );
  }

  const fileName = file.name || "upload.pdf";
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== ".pdf") {
    return NextResponse.json(
      { error: "Audiveris OMR currently supports PDF files only." },
      { status: 400 }
    );
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), "audiveris-"));
  const inputPath = path.join(tempRoot, "input.pdf");
  const outputDir = path.join(tempRoot, "output");

  try {
    await mkdir(outputDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);

    const command = process.env.AUDIVERIS_CMD ?? "audiveris";
    const extraArgs = parseArgs(process.env.AUDIVERIS_ARGS);
    const args = [...extraArgs, "-batch", "-export", "-output", outputDir, inputPath];
    const timeoutMs = Number.parseInt(
      process.env.AUDIVERIS_TIMEOUT_MS ?? "0",
      10
    );

    const result = await runCommand(command, args, tempRoot, timeoutMs);
    if (result.timedOut) {
      return NextResponse.json(
        { error: "Audiveris timed out. Increase AUDIVERIS_TIMEOUT_MS if needed." },
        { status: 504 }
      );
    }

    if (result.code !== 0) {
      return NextResponse.json(
        {
          error: "Audiveris failed to process the PDF.",
          details: result.stderr || result.stdout,
        },
        { status: 500 }
      );
    }

    const musicXmlPath = await findMusicXmlFile(outputDir);
    if (!musicXmlPath) {
      return NextResponse.json(
        {
          error: "Audiveris completed but no MusicXML output was found.",
          details: result.stderr || result.stdout,
        },
        { status: 500 }
      );
    }

    const content = await readFile(musicXmlPath);
    const outputExt = path.extname(musicXmlPath).toLowerCase();
    const format = outputExt === ".mxl" ? "mxl" : "musicxml";

    return NextResponse.json({
      format,
      fileName: path.basename(musicXmlPath),
      content: format === "mxl" ? content.toString("base64") : content.toString("utf-8"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run Audiveris.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
