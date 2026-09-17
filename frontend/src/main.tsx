import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import CalendarPage from "./pages/CalendarPage";
import BookPage from "./pages/BookPage";
import NewBookingPage from "./pages/NewBookingPage";
import StockPage from "./pages/StockPage";
import "./index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <CalendarPage /> },
      { path: "book", element: <BookPage /> },
      { path: "book/new", element: <NewBookingPage /> },
      { path: "book/:id", element: <NewBookingPage /> },
      { path: "stock", element: <StockPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
