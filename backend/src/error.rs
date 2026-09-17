use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Application-level error type. Every handler returns `Result<_, AppError>`,
/// which is converted into a JSON error body with an appropriate status code.
pub enum AppError {
    NotFound(String),
    Validation(String),
    /// Request is well-formed but cannot proceed given current state
    /// (e.g. not enough drones in stock for the requested dates).
    Conflict(String),
    Database(sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m),
            AppError::Validation(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Conflict(m) => (StatusCode::CONFLICT, m),
            AppError::Database(e) => {
                tracing::error!("database error: {e:?}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => AppError::NotFound("resource not found".into()),
            other => AppError::Database(other),
        }
    }
}
