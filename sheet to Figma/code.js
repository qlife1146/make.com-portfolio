// code.js
figma.showUI(__html__, { width: 420, height: 400 });

var STORAGE_KEY = "MAKE_WEBHOOK_URL";

// ----------------------
// Common utils
// ----------------------
function log(text) {
  figma.ui.postMessage({ type: "LOG", text: String(text) });
}

function toFigmaNodeId(nodeId) {
  return String(nodeId || "")
    .trim()
    .replace("-", ":");
}

function trimStr(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

// Make에서 true/false/""(빈값)로 온다고 했으니 문자열 기반 파싱
function parseTriBool(v) {
  var s = trimStr(v).toLowerCase();
  if (s === "") return { has: false, value: false };
  if (s === "true") return { has: true, value: true };
  if (s === "false") return { has: true, value: false };
  if (s === "1") return { has: true, value: true };
  if (s === "0") return { has: true, value: false };
  return { has: false, value: false };
}

function hexToRgb01(hex) {
  var h = trimStr(hex).replace("#", "");
  var full =
    h.length === 3
      ? h
          .split("")
          .map(function (ch) {
            return ch + ch;
          })
          .join("")
      : h;

  var r = parseInt(full.slice(0, 2), 16) / 255;
  var g = parseInt(full.slice(2, 4), 16) / 255;
  var b = parseInt(full.slice(4, 6), 16) / 255;
  return { r: r, g: g, b: b };
}

function supportsStroke(n) {
  return n && "strokes" in n && "strokeWeight" in n;
}

function supportsFill(n) {
  return n && "fills" in n;
}

// ----------------------
// Fonts
// ----------------------
async function loadAllFontsUsedInNode(textNode) {
  var currentText = textNode.characters || "";
  var len = currentText.length;

  if (len > 0) {
    var fonts = textNode.getRangeAllFontNames(0, len);
    for (var i = 0; i < fonts.length; i++) {
      await figma.loadFontAsync(fonts[i]);
    }
  } else {
    if (textNode.fontName !== figma.mixed) {
      await figma.loadFontAsync(textNode.fontName);
    }
  }
}

function pickFamily(textNode) {
  if (textNode.fontName !== figma.mixed) return textNode.fontName.family;

  var currentText = textNode.characters || "";
  if (currentText.length > 0) {
    var fonts = textNode.getRangeAllFontNames(0, currentText.length);
    if (fonts && fonts.length > 0) return fonts[0].family;
  }
  return "Roboto";
}

async function trySetFontStyle(textNode, family, styleCandidates) {
  for (var i = 0; i < styleCandidates.length; i++) {
    var style = styleCandidates[i];
    try {
      await figma.loadFontAsync({ family: family, style: style });
      textNode.fontName = { family: family, style: style };
      return { ok: true, appliedStyle: style };
    } catch (e) {}
  }
  return { ok: false, appliedStyle: null };
}

function setTextFill(textNode, hex) {
  var rgb = hexToRgb01(hex);
  textNode.fills = [{ type: "SOLID", color: rgb, opacity: 1 }];
}

// ----------------------
// Styles (dynamic-page requires Async)
// ----------------------
async function clearFillStyleIdIfPossible(node) {
  try {
    if (typeof node.setFillStyleIdAsync === "function") {
      await node.setFillStyleIdAsync("");
    }
  } catch (e) {}
}

async function clearStrokeStyleIdIfPossible(node) {
  try {
    if (typeof node.setStrokeStyleIdAsync === "function") {
      await node.setStrokeStyleIdAsync("");
    }
  } catch (e) {}
}

async function applyFillSafe(node, hex, nodeIdForLog) {
  try {
    await clearFillStyleIdIfPossible(node);
    var rgb = hexToRgb01(hex);
    node.fills = [{ type: "SOLID", color: rgb, opacity: 1 }];
  } catch (e) {
    log(
      "⚠️ fill apply failed (" +
        nodeIdForLog +
        "): " +
        (e && e.message ? e.message : String(e))
    );
  }
}

async function applyStrokeSafe(node, hex, weight, nodeIdForLog) {
  try {
    await clearStrokeStyleIdIfPossible(node);
    var rgb = hexToRgb01(hex);
    node.strokes = [{ type: "SOLID", color: rgb, opacity: 1 }];
    node.strokeWeight = weight;
    try {
      node.strokeAlign = "OUTSIDE";
    } catch (e) {}
  } catch (e) {
    log(
      "⚠️ stroke apply failed (" +
        nodeIdForLog +
        "): " +
        (e && e.message ? e.message : String(e))
    );
  }
}

function clearStrokeSafe(node, nodeIdForLog) {
  if (!supportsStroke(node)) return;
  try {
    node.strokes = [];
    node.strokeWeight = 0;
  } catch (e) {
    log(
      "⚠️ clearStroke failed (" +
        nodeIdForLog +
        "): " +
        (e && e.message ? e.message : String(e))
    );
  }
}

// ----------------------
// Business logic
// ----------------------
async function applyUpdate(item) {
  var nodeId = toFigmaNodeId(item.node_id);
  var value = trimStr(item.value);

  var colorTri = parseTriBool(item.color);
  var bulletTri = parseTriBool(item.bullet);
  var visibleTri = parseTriBool(item.visible);

  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return { ok: false, reason: "node not found: " + nodeId };

  // (Optional) instance check log
  try {
    var p = node.parent;
    var depth = 0;
    while (p && depth < 10) {
      if (p.type === "INSTANCE") {
        log("ℹ️ " + nodeId + " is inside an INSTANCE: styles may be blocked");
        break;
      }
      p = p.parent;
      depth++;
    }
  } catch (e) {}

  // ------------------------------------------------------------
  // ✅ 우선순위: visible > bullet >= coloring
  // visible=false이면 bullet/coloring이 true여도 무조건 흰색 처리
  // ------------------------------------------------------------
  if (visibleTri.has && visibleTri.value === false) {
    try {
      node.visible = true; // 레이아웃 유지
    } catch (e) {}
    try {
      if ("opacity" in node) node.opacity = 1; // 색으로 가리기
    } catch (e) {}

    var WHITE = "#FFFFFF";

    if (node.type === "TEXT") {
      var textNode0 = node;
      await loadAllFontsUsedInNode(textNode0);
      textNode0.characters = " "; // ✅ 칸 유지

      await applyFillSafe(textNode0, WHITE, nodeId);
      if (supportsStroke(textNode0)) {
        await applyStrokeSafe(textNode0, WHITE, 1, nodeId);
      }
      return { ok: true };
    }

    if (supportsFill(node)) await applyFillSafe(node, WHITE, nodeId);
    if (supportsStroke(node)) await applyStrokeSafe(node, WHITE, 1, nodeId);

    return { ok: true, skipped: true };
  }

  // ------------------------------------------------------------
  // (1) 가림/보임(opacity) — visible 우선, 없으면(value 비어있을 때만) bullet
  // ------------------------------------------------------------
  var hasVisibilityDecision = false;
  var shouldShow = true;

  if (visibleTri.has) {
    hasVisibilityDecision = true;
    shouldShow = visibleTri.value; // true=보임, false=가림(위에서 return)
  } else if (value === "" && bulletTri.has) {
    hasVisibilityDecision = true;
    shouldShow = bulletTri.value;
  }

  if (hasVisibilityDecision) {
    try {
      node.visible = true; // 레이아웃 유지
    } catch (e) {}
    try {
      if ("opacity" in node) node.opacity = shouldShow ? 1 : 0;
    } catch (e) {}
  }

  // ------------------------------------------------------------
  // (2) value 없음 + coloring -> stroke (VECTOR/RECT/FRAME 등 stroke 지원 노드)
  //  - true  : #FD564E, 3
  //  - false : #15181E, 1   (기본 다크)
  // ------------------------------------------------------------
  if (value === "" && colorTri.has && supportsStroke(node)) {
    var strokeHex = colorTri.value ? "#FD564E" : "#15181E";
    var strokeWeight = colorTri.value ? 3 : 1;
    await applyStrokeSafe(node, strokeHex, strokeWeight, nodeId);
  }

  // ------------------------------------------------------------
  // (3) TEXT가 아니면 여기서 끝
  // ------------------------------------------------------------
  if (node.type !== "TEXT") {
    return { ok: true, skipped: true };
  }

  // ------------------------------------------------------------
  // (4) TEXT 값 반영 (빈값이면 공백 1칸)
  // ------------------------------------------------------------
  var textNode = node;
  await loadAllFontsUsedInNode(textNode);
  textNode.characters = value === "" ? " " : value;

  // ------------------------------------------------------------
  // (5) value가 있을 때만 TEXT 스타일 적용 (coloring)
  // value 있음 + color true  -> #FD564E + ExtraBold
  // value 있음 + color false -> #15181E + SemiBold
  // + value가 있는 경우 TEXT stroke는 제거 (value 없는 것만 stroke 규칙)
  // ------------------------------------------------------------
  if (value !== "") {
    clearStrokeSafe(textNode, nodeId);

    if (colorTri.has) {
      var family = pickFamily(textNode);

      if (colorTri.value === true) {
        var r1 = await trySetFontStyle(textNode, family, [
          "ExtraBold",
          "Extra Bold",
          "Black",
          "Heavy",
        ]);
        if (!r1 || !r1.ok) {
          log(
            "⚠️ " +
              nodeId +
              ": ExtraBold 스타일 적용 실패(폰트 스타일명 확인 필요)"
          );
        }
        setTextFill(textNode, "#FD564E");
      } else {
        var r2 = await trySetFontStyle(textNode, family, [
          "SemiBold",
          "Semi Bold",
          "DemiBold",
          "Demi Bold",
          "Medium",
        ]);
        if (!r2 || !r2.ok) {
          log(
            "⚠️ " +
              nodeId +
              ": SemiBold 스타일 적용 실패(폰트 스타일명 확인 필요)"
          );
        }
        setTextFill(textNode, "#15181E");
      }
    }
  }

  return { ok: true };
}

// ----------------------
// PNG Export helpers
// ----------------------
function uint8ToBase64(bytes) {
  return figma.base64Encode(bytes);
}

function getNowFileName() {
  var d = new Date();
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  var yyyy = d.getFullYear();
  var mm = pad(d.getMonth() + 1);
  var dd = pad(d.getDate());
  var hh = pad(d.getHours());
  var mi = pad(d.getMinutes());
  var ss = pad(d.getSeconds());
  return yyyy + mm + dd + "_" + hh + mi + ss + ".png";
}

// ----------------------
// UI Messages
// ----------------------
figma.ui.onmessage = async function (msg) {
  if (!msg || !msg.type) return;

  // (A) URL Storage: GET / SET / CLEAR
  if (msg.type === "GET_SAVED_URL") {
    var saved = await figma.clientStorage.getAsync(STORAGE_KEY);
    figma.ui.postMessage({ type: "SAVED_URL", url: saved || "" });
    return;
  }

  if (msg.type === "SET_SAVED_URL") {
    var url = String(msg.url || "").trim();
    await figma.clientStorage.setAsync(STORAGE_KEY, url);
    figma.ui.postMessage({ type: "SAVED_URL_SET", url: url });
    return;
  }

  if (msg.type === "CLEAR_SAVED_URL") {
    await figma.clientStorage.setAsync(STORAGE_KEY, "");
    figma.ui.postMessage({ type: "SAVED_URL_CLEARED" });
    return;
  }

  // (B) Webhook RUN
  if (msg.type === "RUN") {
    try {
      log("⏳ fetching...");

      var res = await fetch(msg.url, { method: "GET" });
      if (!res.ok)
        throw new Error("Webhook HTTP " + res.status + " " + res.statusText);

      var rawText = await res.text();
      var trimmed = rawText.trim();

      // 응답이 배열이 아니면 단일 객체/조각일 수 있으니 안전 처리
      var jsonText = trimmed[0] === "[" ? trimmed : "[" + trimmed + "]";
      var data = JSON.parse(jsonText);

      if (!Array.isArray(data))
        throw new Error("Webhook 응답이 배열이 아닙니다.");

      var ok = 0;
      var fail = 0;

      for (var i = 0; i < data.length; i++) {
        var item = data[i] || {};
        if (!item.node_id) {
          fail++;
          log("⚠️ skip: node_id 없음 / item=" + JSON.stringify(item));
          continue;
        }

        var r = await applyUpdate(item);
        if (r.ok) {
          ok++;
          log("✅ " + item.node_id);
        } else {
          fail++;
          log("⚠️ " + item.node_id + ": " + r.reason);
        }
      }

      log("🏁 done. ok=" + ok + " fail=" + fail);
      figma.ui.postMessage({ type: "DONE" });
    } catch (e) {
      figma.ui.postMessage({
        type: "ERROR",
        text: e && e.message ? e.message : String(e),
      });
    }
    return;
  }

  // (C) PNG Export
  if (msg.type === "EXPORT_PNG") {
    try {
      var nodeId = toFigmaNodeId(msg.nodeId);
      if (!nodeId) throw new Error("nodeId가 없습니다.");

      var node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error("node not found: " + nodeId);

      log("🧩 export target: " + nodeId + " / type=" + node.type);

      if (typeof node.exportAsync !== "function") {
        throw new Error(
          "exportAsync is not a function (type=" +
            node.type +
            ", id=" +
            nodeId +
            ")"
        );
      }

      log("🖼️ exporting PNG...");
      var bytes = await node.exportAsync({ format: "PNG" });

      figma.ui.postMessage({
        type: "PNG_READY",
        base64: uint8ToBase64(bytes),
        filename: getNowFileName(),
      });
    } catch (e) {
      figma.ui.postMessage({
        type: "ERROR",
        text: e && e.message ? e.message : String(e),
      });
    }
    return;
  }
};
