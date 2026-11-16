/*
This file lists the app's pages (routes): the game on "/" and a "not found" page for everything else.
Edit this file when you add or remove a top-level page.
Copy the route pattern here when you add another top-level page.
*/

import { Route, Routes } from "react-router-dom";
import { GamePage } from "../pages/GamePage";
import { NotFoundPage } from "../pages/NotFoundPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<GamePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
