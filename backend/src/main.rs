mod config;
mod error;
mod handlers;
mod models;

use axum::routing::get;
use axum::Router;
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                "book_my_drone_backend=debug,tower_http=info,info".into()
            }),
        )
        .init();

    let config = Config::from_env()?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await?;

    // Apply embedded migrations on startup.
    sqlx::migrate!("./migrations").run(&pool).await?;

    let state = AppState { pool };

    // Permissive CORS so the Vite dev server (and any deployment origin) works.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(handlers::health))
        .route(
            "/api/drone-types",
            get(handlers::list_drone_types).post(handlers::create_drone_type),
        )
        .route(
            "/api/drone-types/{id}",
            axum::routing::put(handlers::update_drone_type)
                .delete(handlers::delete_drone_type),
        )
        .route(
            "/api/drones",
            get(handlers::list_drones).post(handlers::create_drone),
        )
        .route(
            "/api/drones/{id}",
            axum::routing::put(handlers::update_drone).delete(handlers::delete_drone),
        )
        .route("/api/availability", get(handlers::availability))
        .route(
            "/api/bookings",
            get(handlers::list_bookings).post(handlers::create_booking),
        )
        .route(
            "/api/bookings/{id}",
            get(handlers::get_booking)
                .put(handlers::update_booking)
                .delete(handlers::delete_booking),
        )
        .route("/api/stats", get(handlers::stats))
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&config.bind_addr).await?;
    tracing::info!("Book My Drone API listening on http://{}", config.bind_addr);
    axum::serve(listener, app).await?;

    Ok(())
}
