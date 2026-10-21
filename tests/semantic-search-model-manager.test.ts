import { describe, expect, it } from "vitest";
import {
  computeFraction,
  rollUpState,
  type FileStatus,
} from "../src/modules/semantic-search/model-manager";
import {
  MODELS,
  REQUIRED_MODEL_FILES,
  fileUrl,
  formatBytes,
  getModel,
  modelFolder,
} from "../src/modules/semantic-search/model-registry";

function files(present: boolean[]): FileStatus[] {
  return present.map((p, i) => ({
    file: REQUIRED_MODEL_FILES[i] ?? `f${i}`,
    present: p,
    bytes: p ? 1024 : 0,
  }));
}

describe("rollUpState", () => {
  it("is ready when every file is present", () => {
    expect(rollUpState(files([true, true, true, true]))).toBe("ready");
  });

  it("is missing when no file is present", () => {
    expect(rollUpState(files([false, false, false, false]))).toBe("missing");
  });

  it("is partial when some files are present", () => {
    expect(rollUpState(files([true, false, true, false]))).toBe("partial");
  });

  it("treats a single present file as partial, not ready", () => {
    expect(rollUpState(files([true, false, false, false]))).toBe("partial");
  });
});

describe("computeFraction", () => {
  it("is 0 at the start", () => {
    expect(computeFraction(0, 4)).toBe(0);
  });

  it("is 1 when every file is done", () => {
    expect(computeFraction(4, 4)).toBe(1);
  });

  it("steps evenly between files", () => {
    expect(computeFraction(1, 4)).toBeCloseTo(0.25, 10);
    expect(computeFraction(2, 4)).toBeCloseTo(0.5, 10);
  });

  it("accounts for progress inside the current file", () => {
    expect(computeFraction(1, 4, 0.5)).toBeCloseTo(0.375, 10);
  });

  it("never exceeds 1", () => {
    expect(computeFraction(9, 4)).toBe(1);
    expect(computeFraction(3, 4, 5)).toBe(1);
  });

  it("handles an empty file list", () => {
    expect(computeFraction(0, 0)).toBe(0);
  });
});

describe("fileUrl", () => {
  const spec = getModel("multilingual-e5-small");

  it("points at the model's repo", () => {
    expect(fileUrl(spec, "config.json")).toContain("Xenova/multilingual-e5-small");
  });

  it("keeps the onnx subfolder in the path", () => {
    expect(fileUrl(spec, "onnx/model_quantized.onnx")).toContain(
      "/resolve/main/onnx/model_quantized.onnx",
    );
  });

  it("builds a url for every required file of every model", () => {
    for (const model of MODELS) {
      for (const file of REQUIRED_MODEL_FILES) {
        expect(fileUrl(model, file)).toMatch(/^https:\/\/huggingface\.co\//);
      }
    }
  });
});

describe("modelFolder", () => {
  it("joins the base path and the model key", () => {
    expect(modelFolder(".models", "abc")).toBe(".models/abc");
  });

  it("falls back to .models when the base is empty", () => {
    expect(modelFolder("", "abc")).toBe(".models/abc");
  });

  it("strips a trailing slash", () => {
    expect(modelFolder("models/", "abc")).toBe("models/abc");
  });
});

describe("formatBytes", () => {
  it("formats zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats megabytes", () => {
    expect(formatBytes(118_000_000)).toMatch(/MB$/);
  });

  it("handles a negative or invalid size", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});
