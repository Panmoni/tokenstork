//! Google Cloud Vision API — SafeSearch only.
//!
//! Tiny REST client for the `images:annotate` endpoint with the
//! `SAFE_SEARCH_DETECTION` feature. We never use any other Vision feature
//! (label detection, OCR, etc.) so the client surface stays minimal.
//!
//! Auth is via API key (the simpler of the two paths the Vision API
//! supports — the alternative is service-account OAuth, which adds more
//! ceremony than this use case warrants).
//!
//! Plan reference: docs/icon-safety-plan.md (Phase A, step 3).

use anyhow::{Context, Result, anyhow};
use base64::Engine;
use serde::{Deserialize, Serialize};

const VISION_ENDPOINT: &str = "https://vision.googleapis.com/v1/images:annotate";

/// Normalised SafeSearch sub-scores. Each is in [0.0, 1.0].
///
/// Google returns enum strings (`UNKNOWN`, `VERY_UNLIKELY`, `UNLIKELY`,
/// `POSSIBLE`, `LIKELY`, `VERY_LIKELY`) which we map to floats so the
/// classifier in `icons.rs` can apply numeric thresholds.
#[derive(Debug, Clone, Copy)]
pub struct SafeSearchScores {
    pub adult: f32,
    pub racy: f32,
    pub violence: f32,
    pub spoof: f32,
    pub medical: f32,
}

impl SafeSearchScores {
    /// Combined "block-worthy?" score. v1 = max(adult, racy) — the two
    /// dimensions actually targeting the kind of content we want to gate.
    /// `spoof`, `violence`, and `medical` are observational only; we
    /// don't block on them.
    pub fn nsfw_score(&self) -> f32 {
        self.adult.max(self.racy)
    }
}

/// Google's enum → float ladder.
///
/// Calibrated against the published thresholds in
/// <https://cloud.google.com/vision/docs/detecting-safe-search>:
///   VERY_UNLIKELY  ~  0.0 - 0.1
///   UNLIKELY       ~  0.1 - 0.3
///   POSSIBLE       ~  0.3 - 0.6
///   LIKELY         ~  0.6 - 0.8
///   VERY_LIKELY    ~  0.8 - 1.0
fn likelihood_to_score(s: &str) -> f32 {
    match s {
        "VERY_UNLIKELY" => 0.05,
        "UNLIKELY" => 0.20,
        "POSSIBLE" => 0.50,
        "LIKELY" => 0.70,
        "VERY_LIKELY" => 0.90,
        _ => 0.0, // UNKNOWN or anything we don't recognise — be conservative.
    }
}

/// Run SafeSearch on the given image bytes.
///
/// Returns the normalised score struct. Network/parse errors surface as
/// `Err`; the caller treats those as "scan failed, leave URL pending,
/// retry next tick" — we never auto-clear on a Vision API error.
pub async fn safe_search(
    client: &reqwest::Client,
    api_key: &str,
    image_bytes: &[u8],
) -> Result<SafeSearchScores> {
    // Vision wants base64-encoded image content in the request body.
    let b64 = base64::engine::general_purpose::STANDARD.encode(image_bytes);

    let body = AnnotateRequest {
        requests: vec![ImageRequest {
            image: ImageContent { content: b64 },
            features: vec![Feature {
                type_: "SAFE_SEARCH_DETECTION",
                max_results: 1,
            }],
        }],
    };

    // API key in header, NOT query param. Both forms authenticate identically
    // for SafeSearch, but the header keeps the key out of any URL that
    // reqwest/anyhow includes in error chains, panic backtraces, or tracing
    // diagnostics — which would otherwise leak the credential to journalctl
    // on every Vision API failure.
    let resp = client
        .post(VISION_ENDPOINT)
        .header("X-Goog-Api-Key", api_key)
        .json(&body)
        .send()
        .await
        .context("vision: send request")?;

    let status = resp.status();
    let text = resp.text().await.context("vision: read body")?;

    if !status.is_success() {
        return Err(anyhow!("vision: HTTP {} — {}", status.as_u16(), text));
    }

    let parsed: AnnotateResponse =
        serde_json::from_str(&text).with_context(|| format!("vision: parse response: {}", text))?;

    let first = parsed
        .responses
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("vision: empty responses array"))?;

    if let Some(err) = first.error {
        return Err(anyhow!("vision: {} — {}", err.code, err.message));
    }

    let ann = first
        .safe_search_annotation
        .ok_or_else(|| anyhow!("vision: missing safeSearchAnnotation"))?;

    Ok(SafeSearchScores {
        adult: likelihood_to_score(&ann.adult),
        racy: likelihood_to_score(&ann.racy),
        violence: likelihood_to_score(&ann.violence),
        spoof: likelihood_to_score(&ann.spoof),
        medical: likelihood_to_score(&ann.medical),
    })
}

// ---------------------------------------------------------------------------
// Wire types — visibility-restricted; only the public API surfaces.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct AnnotateRequest {
    requests: Vec<ImageRequest>,
}

#[derive(Serialize)]
struct ImageRequest {
    image: ImageContent,
    features: Vec<Feature>,
}

#[derive(Serialize)]
struct ImageContent {
    content: String,
}

#[derive(Serialize)]
struct Feature {
    #[serde(rename = "type")]
    type_: &'static str,
    #[serde(rename = "maxResults")]
    max_results: u32,
}

#[derive(Deserialize)]
struct AnnotateResponse {
    responses: Vec<ResponseEntry>,
}

#[derive(Deserialize)]
struct ResponseEntry {
    #[serde(rename = "safeSearchAnnotation")]
    safe_search_annotation: Option<SafeSearchAnnotation>,
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct SafeSearchAnnotation {
    adult: String,
    racy: String,
    violence: String,
    spoof: String,
    medical: String,
}

#[derive(Deserialize)]
struct ApiError {
    code: i32,
    message: String,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn likelihood_ladder_is_monotonic() {
        let levels = ["VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"];
        let scores: Vec<f32> = levels.iter().map(|l| likelihood_to_score(l)).collect();
        for window in scores.windows(2) {
            assert!(window[0] < window[1], "ladder should be strictly increasing");
        }
    }

    #[test]
    fn unknown_likelihood_is_safe_zero() {
        assert_eq!(likelihood_to_score("UNKNOWN"), 0.0);
        assert_eq!(likelihood_to_score(""), 0.0);
        assert_eq!(likelihood_to_score("BOGUS"), 0.0);
    }

    #[test]
    fn nsfw_score_takes_max_of_adult_and_racy() {
        let scores = SafeSearchScores {
            adult: 0.7,
            racy: 0.9,
            violence: 0.3,
            spoof: 0.1,
            medical: 0.05,
        };
        assert_eq!(scores.nsfw_score(), 0.9);

        let scores = SafeSearchScores {
            adult: 0.95,
            racy: 0.5,
            violence: 0.99, // ignored
            spoof: 0.99,
            medical: 0.99,
        };
        assert_eq!(scores.nsfw_score(), 0.95);
    }
}
