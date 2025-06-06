"use client";
import { useState, useEffect  } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [scenePrompts, setScenePrompts] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"idle" | "working">("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFileName, setDownloadFileName] = useState<string | null>(null);
  const [downloadFileSize, setDownloadFileSize] = useState<number | null>(null);

  useEffect(() => {
    // Clean up blob URL on new download or unmount
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  const handleUpload = async () => {
  
    if (!file) return;
  setLoading(true)
  setError("");
  setScenePrompts([]);
  setDownloadUrl(null);  // Clean up old url
  setDownloadFileName(null);
  setDownloadFileSize(null);
  setStep("working"); // <-- Set to working

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/process-pdf", {
    method: "POST",
    body: formData,
  });

  setStep("idle"); // <-- Back to idle after done

  if (!res.ok) {
    if (res.status === 422) {
      setError("Sorry, unable to detect text in the selected PDF. Please choose a file with extractable text (not a scanned image).");
    } else {
    setError(`Upload failed with status ${res.status}`);
    }
    setLoading(false);
    return;
  }

  

  // Download directly as PDF
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  // Get the original name, append _illustrated, always ends with .pdf
  let name = file.name.replace(/\.pdf$/i, "");
  name += "_illustrated.pdf";
  setDownloadFileName(name);
  // Get file size in MB rounded to 1 decimal
  setDownloadFileSize(Number((blob.size / (1024 * 1024)).toFixed(1)));
  setDownloadUrl(url); // Save for the button
  setLoading(false);
};

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Text Illustrator</h1>
      <p className="text-sm text-gray-500 mb-2">
        Upload your PDF and get it back as an illustrated book, complete with AI-generated images!
      </p>
      {/* File picker, etc */}
      {error && <div className="text-red-600 mt-2">{error}</div>}
      <input
        type="file"
        accept="application/pdf"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="mb-4 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
        disabled={step === "working"}
      />
      <div className="mb-4">
        {file ? (
          <span className="text-green-600 font-semibold">Selected file: {file.name}</span>
        ) : (
          <span className="text-gray-500">No file selected.</span>
        )}
      </div>
      <button
        onClick={handleUpload}
        className="bg-blue-600 text-white px-4 py-2 rounded disabled:bg-gray-400"
        disabled={!file || step === "working"}
      >
        {step === "working" ? "Illustrating..." : "Upload & Illustrate"}
      </button>
      {step === "working" && (
        <div className="mt-4 flex items-center space-x-2 text-blue-700">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span>Generating PDF, please wait...</span>
        </div>
      )}
      {error && <p className="mt-4 text-red-600">{error}</p>}

      <div className="mt-6 w-full space-y-6">
        {scenePrompts.map((scene, i) => (
          <div key={i} className="rounded border p-3 shadow bg-white">
            <div className="mb-1 font-semibold text-gray-700">Illustration Scene {i + 1}:</div>
            <div className="italic text-gray-600 mb-2">{scene}</div>
          </div>
        ))}
      </div>

      {/* Manual download button */}
      {downloadUrl && downloadFileName && (
        <div className="mt-8 text-center">
          <div className="mb-2 text-gray-800 text-sm">
            <span className="font-bold">File:</span> {downloadFileName}{" "}
            {downloadFileSize !== null && (
              <span className="ml-2 text-gray-500">({downloadFileSize} MB)</span>
            )}
          </div>
          <a
            href={downloadUrl}
            download={downloadFileName}
            className="bg-green-600 text-white px-6 py-2 rounded shadow font-bold hover:bg-green-700"
          >
            Download Illustrated PDF
          </a>
        </div>
      )}
    </main>
  );
}