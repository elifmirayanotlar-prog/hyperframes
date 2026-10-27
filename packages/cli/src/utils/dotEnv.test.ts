import { describe, expect, it } from "vitest";
import { applyDotEnv, CAPTURE_ENV_KEYS } from "./dotEnv.js";

describe("applyDotEnv", () => {
  it("copies a project's keys without overwriting what is already set", () => {
    const env: NodeJS.ProcessEnv = { KEPT: "outer" };
    applyDotEnv('export GEMINI_KEY="abc" # note\nKEPT=inner\n# comment\nPLAIN=x #c', env);
    expect(env).toEqual({ KEPT: "outer", GEMINI_KEY: "abc", PLAIN: "x" });
  });

  it("never takes the feedback email from a project file", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("HYPERFRAMES_FEEDBACK_EMAIL=someone@example.com\nOTHER=1", env);
    expect(env).toEqual({ OTHER: "1" });
  });

  it("never takes the feedback email under another letter case", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv(
      "hyperframes_feedback_email=a@example.com\nHyperFrames_Feedback_Email=b@example.com\nOTHER=1",
      env,
    );
    expect(env).toEqual({ OTHER: "1" });
  });

  it("copies only exact allowed names when a caller limits the imported settings", () => {
    const env: NodeJS.ProcessEnv = { GEMINI_API_KEY: "inherited" };
    applyDotEnv(
      "GEMINI_API_KEY=project\nGOOGLE_API_KEY=allowed\ngoogle_api_key=other\nPATH=/untrusted\nLD_PRELOAD=payload",
      env,
      ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    );
    expect(env).toEqual({ GEMINI_API_KEY: "inherited", GOOGLE_API_KEY: "allowed" });
  });

  it("an allowlist cannot opt the feedback email back in", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("HyperFrames_Feedback_Email=private", env, ["HyperFrames_Feedback_Email"]);
    expect(env).toEqual({});
  });

  it("an empty allowlist imports nothing", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("GEMINI_API_KEY=project", env, []);
    expect(env).toEqual({});
  });
});

describe("applyDotEnv quoted multiline values", () => {
  it("keeps a quoted multiline value whole instead of truncating it to its first line", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv(
      "HYPERFRAMES_VERTEX_PROJECT_ID=synthetic-project\n" +
        "HYPERFRAMES_VERTEX_SERVICE_ACCOUNT='{\n" +
        '  "type": "service_account",\n' +
        '  "project_id": "synthetic-project"\n' +
        "}'\n" +
        "AFTER=still-parsed",
      env,
    );
    expect(env.HYPERFRAMES_VERTEX_SERVICE_ACCOUNT).toBe(
      '{\n  "type": "service_account",\n  "project_id": "synthetic-project"\n}',
    );
    expect(() => JSON.parse(env.HYPERFRAMES_VERTEX_SERVICE_ACCOUNT!)).not.toThrow();
    expect(env.AFTER).toBe("still-parsed");
  });

  it("a commented-out example with an unclosed quote does not swallow the real keys below it", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv('# OPENROUTER_API_KEY="sk-old\nGEMINI_API_KEY=real1\nGOOGLE_API_KEY=real2', env);
    expect(env).toEqual({ GEMINI_API_KEY: "real1", GOOGLE_API_KEY: "real2" });
  });

  it("a stray unclosed quote with no later closing line does not swallow the rest of the file", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("A='x\nB=2", env);
    expect(env).toEqual({ A: "x", B: "2" });
  });

  it("strips the trailing \\r from a CRLF multiline value", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("KEY='line1\r\nline2'\r\nAFTER=2", env);
    expect(env.KEY).toBe("line1\nline2");
    expect(env.AFTER).toBe("2");
  });
});

describe("applyDotEnv custom vision credentials", () => {
  const vision = {
    HYPERFRAMES_VISION_BASE_URL: "https://vision.example/v1",
    HYPERFRAMES_VISION_API_KEY: "fixture-key",
    HYPERFRAMES_VISION_MODEL: "fixture-model",
  };
  const content = Object.entries(vision)
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");

  it("loads all three values through the capture allowlist", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv(content, env, CAPTURE_ENV_KEYS);
    expect(env).toEqual(vision);
  });

  it.each(Object.keys(vision))("keeps an inherited %s separate from a project endpoint", (key) => {
    const env: NodeJS.ProcessEnv = { [key]: "inherited" };
    applyDotEnv(`${content}\nGEMINI_API_KEY=other-provider`, env, CAPTURE_ENV_KEYS);
    expect(env).toEqual({ [key]: "inherited", GEMINI_API_KEY: "other-provider" });
  });

  it("keeps an empty inherited value separate too", () => {
    const env: NodeJS.ProcessEnv = { HYPERFRAMES_VISION_API_KEY: "" };
    applyDotEnv(content, env, CAPTURE_ENV_KEYS);
    expect(env).toEqual({ HYPERFRAMES_VISION_API_KEY: "" });
  });

  it("keeps a complete inherited endpoint unchanged", () => {
    const env: NodeJS.ProcessEnv = { ...vision };
    applyDotEnv(content.replaceAll("fixture", "project"), env, CAPTURE_ENV_KEYS);
    expect(env).toEqual(vision);
  });

  it("keeps a partial first file from borrowing values from a later file", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv("HYPERFRAMES_VISION_API_KEY=first-file", env, CAPTURE_ENV_KEYS);
    applyDotEnv(content, env, CAPTURE_ENV_KEYS);
    expect(env).toEqual({ HYPERFRAMES_VISION_API_KEY: "first-file" });
  });

  it("keeps the first complete file when another endpoint is loaded later", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotEnv(content, env, CAPTURE_ENV_KEYS);
    applyDotEnv(content.replaceAll("fixture", "parent"), env, CAPTURE_ENV_KEYS);
    expect(env).toEqual(vision);
  });

  it("also keeps credential sources separate without an allowlist", () => {
    const env: NodeJS.ProcessEnv = { HYPERFRAMES_VISION_API_KEY: "inherited" };
    applyDotEnv(content, env);
    expect(env).toEqual({ HYPERFRAMES_VISION_API_KEY: "inherited" });
  });

  it("keeps mixed-case project keys separate on a case-insensitive environment", () => {
    const values: NodeJS.ProcessEnv = { HYPERFRAMES_VISION_API_KEY: "inherited" };
    const env = new Proxy(values, {
      has: (target, key) => typeof key === "string" && key.toUpperCase() in target,
      set: (target, key, value: string) => {
        if (typeof key !== "string") return false;
        target[key.toUpperCase()] = value;
        return true;
      },
    });
    applyDotEnv(
      "hyperframes_vision_base_url=https://project.example/v1\nHyperFrames_Vision_Model=project-model",
      env,
    );
    expect(values).toEqual({ HYPERFRAMES_VISION_API_KEY: "inherited" });
  });
});
