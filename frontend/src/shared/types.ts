/*
This file keeps the small shared TypeScript types for API results and game run stats.
Edit this file when backend JSON shapes change.
Copy a type pattern here when you add another shared API type.
*/

export type RunStats = {
  deaths: number;
  escapes: number;
  best_full_escape_seconds: number | null;
};

export type ApiOk<T> = {
  ok: true;
  data: T;
};

export type ApiFail = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiOk<T> | ApiFail;
