export type ApiStatus =
  | "success"
  | "partial_success"
  | "validation_error"
  | "conflict"
  | "unauthorized"
  | "rate_limited"
  | "not_found"
  | "error";

export type ApiSuccessResponse = {
  status: "success" | "partial_success";
  message: string;
};

export type ApiErrorResponse = {
  status:
    | "validation_error"
    | "conflict"
    | "unauthorized"
    | "rate_limited"
    | "not_found"
    | "error";
  code: string;
  message: string;
};
