import { useRef, useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useEditorTheme } from "../../hooks/useEditorTheme";
import { applyGridTheme, readGridTheme } from "../../internal/theme";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("copies independent themes and removes stale tokens without copying geometry", () => {
  const source = document.createElement("div");
  source.style.cssText =
    "--dgr-background: black; --dgr-error-color: pink; font-family: monospace; font-size: 17px; color: white; direction: rtl; width: 400px;";
  document.body.append(source);
  const first = document.createElement("div");
  const second = document.createElement("div");
  applyGridTheme(first, readGridTheme(source));
  applyGridTheme(second, { "--dgr-background": "white" });
  expect(first.style.getPropertyValue("--dgr-background")).toBe("black");
  expect(first.style.getPropertyValue("--dgr-error-color")).toBe("pink");
  expect(first.style.fontFamily).toBe("monospace");
  expect(first.style.fontSize).toBe("17px");
  expect(first.style.color).toBe("rgb(255, 255, 255)");
  expect(first.style.direction).toBe("rtl");
  expect(first.style.width).toBe("");
  source.style.removeProperty("--dgr-background");
  applyGridTheme(first, readGridTheme(source));
  expect(first.style.getPropertyValue("--dgr-background")).toBe("");
  expect(second.style.getPropertyValue("--dgr-background")).toBe("white");
  applyGridTheme(first, {});
  expect(first.style.fontFamily).toBe("");
  source.remove();
});

function Harness({ open = true }: { open?: boolean }) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEditorTheme(sourceRef, host);
  return (
    <>
      <section data-testid="ancestor">
        <div ref={sourceRef} data-testid="source" />
      </section>
      {open && <div ref={setHost} data-testid="host" />}
    </>
  );
}

it("refreshes on ancestor changes and resize, remounts fresh, and cleans subscriptions", async () => {
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  const remove = vi.spyOn(window, "removeEventListener");
  const { getByTestId, rerender, unmount } = render(<Harness />);
  const source = getByTestId("source");
  source.style.setProperty("--dgr-background", "black");
  await waitFor(() =>
    expect(getByTestId("host").style.getPropertyValue("--dgr-background")).toBe(
      "black"
    )
  );
  const ancestor = getByTestId("ancestor");
  ancestor.className = "theme";
  source.style.setProperty("--dgr-background", "navy");
  await waitFor(() =>
    expect(getByTestId("host").style.getPropertyValue("--dgr-background")).toBe(
      "navy"
    )
  );
  rerender(<Harness open={false} />);
  expect(disconnect).toHaveBeenCalled();
  source.style.removeProperty("--dgr-background");
  rerender(<Harness />);
  expect(getByTestId("host").style.getPropertyValue("--dgr-background")).toBe(
    ""
  );
  act(() => window.dispatchEvent(new Event("resize")));
  unmount();
  expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
});

it("observes ancestor theme changes and media changes without subscribing the grid body", async () => {
  const original = window.getComputedStyle.bind(window);
  let systemDark = false;
  let listener: (() => void) | undefined;
  const remove = vi.fn();
  vi.stubGlobal("matchMedia", () => ({
    addEventListener: (_: string, callback: () => void) => {
      listener = callback;
    },
    removeEventListener: remove,
  }));
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const result = original(element);
    if (element instanceof HTMLElement && element.dataset.testid === "source") {
      const read = result.getPropertyValue.bind(result);
      result.getPropertyValue = (name) =>
        name === "--dgr-background"
          ? element.parentElement?.className === "dark" || systemDark
            ? "black"
            : "white"
          : read(name);
    }
    return result;
  });
  const { getByTestId, unmount } = render(<Harness />);
  expect(getByTestId("host").style.getPropertyValue("--dgr-background")).toBe(
    "white"
  );
  getByTestId("ancestor").className = "dark";
  await waitFor(() =>
    expect(getByTestId("host").style.getPropertyValue("--dgr-background")).toBe(
      "black"
    )
  );
  getByTestId("ancestor").className = "";
  await waitFor(() =>
    expect(getByTestId("host").style.getPropertyValue("--dgr-background")).toBe(
      "white"
    )
  );
  systemDark = true;
  act(() => listener?.());
  await waitFor(() =>
    expect(getByTestId("host").style.getPropertyValue("--dgr-background")).toBe(
      "black"
    )
  );
  unmount();
  expect(remove).toHaveBeenCalledWith("change", listener);
  vi.unstubAllGlobals();
});
