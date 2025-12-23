"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import styles from "./page.module.css";

const workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

GlobalWorkerOptions.workerSrc = workerSrc;

type PageSize = {
  width: number;
  height: number;
};

const GAP_PX = 24;
const MIN_TWO_UP_SCALE = 0.68;

export default function Home() {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileKind, setFileKind] = useState<"pdf" | "xml" | "unsupported" | null>(null);
  const [textPreview, setTextPreview] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [spreadOffset, setSpreadOffset] = useState(false);
  const [pageInput, setPageInput] = useState("");
  const [isEditingPage, setIsEditingPage] = useState(false);

  const viewerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);

  useEffect(() => {
    const node = viewerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdfDoc) {
      setPageSize(null);
      return;
    }
    let cancelled = false;
    pdfDoc.getPage(1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      setPageSize({ width: viewport.width, height: viewport.height });
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  const canTwoUp = useMemo(() => {
    if (!pageSize || !containerWidth) return false;
    const scaleTwoUp = (containerWidth - GAP_PX) / 2 / pageSize.width;
    return scaleTwoUp >= MIN_TWO_UP_SCALE;
  }, [containerWidth, pageSize]);

  const normalizePageIndex = useCallback(
    (value: number) => {
      if (!pageCount) return 1;
      const clamped = Math.min(Math.max(1, value), pageCount);
      if (!canTwoUp) return clamped;
      if (spreadOffset) {
        if (clamped === 1) return 1;
        if (clamped % 2 === 1) return clamped - 1;
        return clamped;
      }
      if (clamped % 2 === 0) return Math.max(1, clamped - 1);
      return clamped;
    },
    [canTwoUp, pageCount, spreadOffset]
  );

  useEffect(() => {
    if (!pdfDoc || !canTwoUp) return;
    setPageIndex((current) => normalizePageIndex(current));
  }, [canTwoUp, pdfDoc, normalizePageIndex]);

  const spreadSlots = useMemo(() => {
    if (!pdfDoc) return [];
    if (!canTwoUp) {
      return [{ pageNumber: pageIndex, key: `page-${pageIndex}`, position: "single" }];
    }
    if (spreadOffset && pageIndex === 1) {
      return [
        { pageNumber: null, key: "blank-left", position: "left" },
        { pageNumber: 1, key: "page-1", position: "right" },
      ];
    }
    const leftPage = pageIndex;
    const rightPage = pageIndex + 1 <= pageCount ? pageIndex + 1 : null;
    return [
      { pageNumber: leftPage, key: `page-${leftPage}`, position: "left" },
      {
        pageNumber: rightPage,
        key: rightPage ? `page-${rightPage}` : "blank-right",
        position: "right",
      },
    ];
  }, [pdfDoc, canTwoUp, spreadOffset, pageIndex, pageCount]);

  const visiblePages = useMemo(
    () =>
      spreadSlots
        .map((slot) => slot.pageNumber)
        .filter((page): page is number => typeof page === "number"),
    [spreadSlots]
  );

  useEffect(() => {
    if (!pdfDoc || !pageSize || !containerWidth || spreadSlots.length === 0) {
      return;
    }

    let cancelled = false;
    const renderTasks: Array<{ cancel: () => void }> = [];

    const render = async () => {
      setRendering(true);
      const targetWidth = canTwoUp
        ? (containerWidth - GAP_PX) / 2
        : containerWidth;
      const scale = targetWidth / pageSize.width;

      await Promise.all(
        spreadSlots.map(async (slot, index) => {
          if (!slot.pageNumber) return;
          const canvas = canvasRefs.current[index];
          if (!canvas) return;
          const page = await pdfDoc.getPage(slot.pageNumber);
          if (cancelled) return;

          const viewport = page.getViewport({ scale });
          const offscreen = document.createElement("canvas");
          offscreen.width = Math.floor(viewport.width);
          offscreen.height = Math.floor(viewport.height);

          const offscreenContext = offscreen.getContext("2d", {
            alpha: false,
          });
          if (!offscreenContext) return;

          const renderTask = page.render({
            canvasContext: offscreenContext,
            viewport,
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
          if (cancelled) return;

          canvas.width = offscreen.width;
          canvas.height = offscreen.height;
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) return;
          context.drawImage(offscreen, 0, 0);
        })
      );

      if (!cancelled) {
        setRendering(false);
      }
    };

    render();

    return () => {
      cancelled = true;
      renderTasks.forEach((task) => task.cancel());
    };
  }, [pdfDoc, spreadSlots, containerWidth, pageSize, canTwoUp]);

  const clearDoc = useCallback(() => {
    setPdfDoc(null);
    setPageCount(0);
    setPageIndex(1);
    setPageSize(null);
    setTextPreview("");
    setFileKind(null);
    setStatus(null);
    setFileName("");
    setRendering(false);
    setPageInput("");
    setIsEditingPage(false);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setStatus("Loading file...");
    setFileName(file.name);
    setRendering(false);
    setTextPreview("");
    setFileKind(null);
    setPdfDoc(null);
    setPageCount(0);
    setPageIndex(1);
    setPageInput("");

    const lowerName = file.name.toLowerCase();
    const isPdf =
      file.type === "application/pdf" || lowerName.endsWith(".pdf");
    const isXml =
      file.type.includes("xml") ||
      lowerName.endsWith(".xml") ||
      lowerName.endsWith(".musicxml") ||
      lowerName.endsWith(".mxl");

    if (isPdf) {
      try {
        const data = await file.arrayBuffer();
        const loadingTask = getDocument({ data });
        const doc = await loadingTask.promise;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        setFileKind("pdf");
        setStatus(null);
        setPageInput("1");
      } catch {
        setStatus("Failed to load PDF.");
      }
      return;
    }

    if (isXml) {
      const text = await file.text();
      setTextPreview(text);
      setFileKind("xml");
      setStatus(null);
      return;
    }

    setFileKind("unsupported");
    setStatus("Unsupported file type. Please upload a PDF or MusicXML/XML.");
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await handleFile(file);
    },
    [handleFile]
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      await handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    []
  );

  const goPrev = useCallback(() => {
    const delta = canTwoUp ? 2 : 1;
    setPageIndex((current) => normalizePageIndex(current - delta));
  }, [canTwoUp, normalizePageIndex]);

  const goNext = useCallback(() => {
    const delta = canTwoUp ? 2 : 1;
    setPageIndex((current) => normalizePageIndex(current + delta));
  }, [canTwoUp, normalizePageIndex]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  const commitPageInput = useCallback(() => {
    if (!pdfDoc || !pageCount) return;
    const value = Number.parseInt(pageInput, 10);
    if (Number.isNaN(value)) {
      setPageInput(String(pageIndex));
      return;
    }
    setPageIndex(normalizePageIndex(value));
  }, [pdfDoc, pageCount, pageInput, pageIndex, normalizePageIndex]);

  useEffect(() => {
    if (!pdfDoc) {
      setPageInput("");
      return;
    }
    if (isEditingPage) return;
    setPageInput(String(pageIndex));
  }, [pageIndex, pdfDoc, isEditingPage]);

  const pageRangeLabel = useMemo(() => {
    if (!pageCount || !visiblePages.length) return "";
    const minPage = Math.min(...visiblePages);
    const maxPage = Math.max(...visiblePages);
    if (minPage === maxPage) {
      return `Showing ${minPage}`;
    }
    return `Showing ${minPage}-${maxPage}`;
  }, [pageCount, visiblePages]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <div>
            <p className={styles.kicker}>Local Sheet Viewer</p>
            <h1>Page Turn Studio</h1>
          </div>
        </div>
        <div className={styles.controls}>
          <label className={styles.fileButton}>
            <input
              type="file"
              accept=".pdf,.xml,.musicxml,.mxl,application/pdf,application/xml,text/xml"
              onChange={handleFileChange}
            />
            <span>Choose file</span>
          </label>
          {fileName ? (
            <div className={styles.fileMeta}>
              <p className={styles.fileName}>{fileName}</p>
              <button className={styles.clearButton} onClick={clearDoc}>
                Clear
              </button>
            </div>
          ) : (
            <p className={styles.helper}>PDF or MusicXML only. Stays local.</p>
          )}
        </div>
      </header>

      <section className={styles.viewerShell}>
        <div className={styles.viewerToolbar}>
          <div className={styles.navGroup}>
            <button
              className={styles.navButton}
              onClick={goPrev}
              disabled={!pdfDoc || pageIndex <= 1}
            >
              Prev
            </button>
            <button
              className={styles.navButton}
              onClick={goNext}
              disabled={!pdfDoc || pageIndex >= pageCount}
            >
              Next
            </button>
          </div>
          <div className={styles.pageStatus}>
            <label className={styles.pageJump}>
              <span>Page</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={pageCount || 1}
                value={pageInput}
                onFocus={() => setIsEditingPage(true)}
                onBlur={() => {
                  setIsEditingPage(false);
                  commitPageInput();
                }}
                onChange={(event) => setPageInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitPageInput();
                    (event.currentTarget as HTMLInputElement).blur();
                  }
                }}
                disabled={!pdfDoc}
                aria-label="Jump to page"
              />
            </label>
            <span className={styles.pageTotal}>
              {pageCount ? `of ${pageCount}` : "of -"}
            </span>
            {pageRangeLabel && (
              <span className={styles.pageRange}>{pageRangeLabel}</span>
            )}
          </div>
          <div className={styles.modeGroup}>
            <label className={styles.offsetToggle}>
              <input
                type="checkbox"
                checked={spreadOffset}
                onChange={() => setSpreadOffset((prev) => !prev)}
                disabled={!canTwoUp}
              />
              <span>Offset spread</span>
            </label>
            <div className={styles.modeBadge}>
              {canTwoUp ? "Two-page" : "Single-page"}
            </div>
          </div>
        </div>

        <div
          className={styles.viewer}
          ref={viewerRef}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {!fileKind && (
            <div className={styles.placeholder}>
              <p>Drop a PDF or MusicXML to start.</p>
              <span>Pages render locally in your browser.</span>
            </div>
          )}

          {status && <div className={styles.status}>{status}</div>}

          {fileKind === "pdf" && (
            <div className={styles.canvasRow} data-two-up={canTwoUp}>
              {spreadSlots.map((slot, index) => (
                <div
                  key={index}
                  className={styles.canvasFrame}
                  data-empty={!slot.pageNumber}
                  data-position={slot.position}
                  style={{ animationDelay: `${index * 80}ms` }}
                >
                  {slot.pageNumber ? (
                    <canvas
                      ref={(el) => {
                        canvasRefs.current[index] = el;
                      }}
                      aria-label={`Page ${slot.pageNumber}`}
                    />
                  ) : (
                    <div
                      className={styles.blankPage}
                      style={{
                        aspectRatio: pageSize
                          ? `${pageSize.width} / ${pageSize.height}`
                          : "3 / 4",
                      }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {fileKind === "xml" && (
            <pre className={styles.xmlPreview}>
              {textPreview || "No XML content found."}
            </pre>
          )}

          {fileKind === "unsupported" && (
            <div className={styles.status}>
              Unsupported file. Please upload a PDF or MusicXML.
            </div>
          )}

          {rendering && fileKind === "pdf" && (
            <div className={styles.rendering}>Rendering pages...</div>
          )}
        </div>
      </section>
    </div>
  );
}
