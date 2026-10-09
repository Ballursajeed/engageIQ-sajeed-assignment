import { ApiError } from "../lib/core.js";

export async function sendWapixOtp(phone: string, code: string) {
  const apiKey = process.env.WAPIX_KEY?.trim();

  if (!apiKey) {
    throw new ApiError(
      503,
      "OTP_NOT_CONFIGURED",
      "OTP delivery is not configured",
    );
  }

  let response: Response;

  try {
    response = await fetch(
      "https://api.wapix.sbs/api/v1/send/otp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          service: "otp",
          text: "Your EngageIQ verification code is:",
          otp: code,
          api_key: apiKey,
          whatsaap_number: phone.replace(/^\+/, ""),
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
  } catch {
    // Do not retry automatically: the provider may have received the request.
    throw new ApiError(
      502,
      "OTP_DELIVERY_UNCONFIRMED",
      "Could not confirm OTP delivery. Please wait before requesting another code.",
    );
  }

  const result: unknown = await response.json().catch(() => null);

  // These checks catch explicit failures. Wapix's full response
  // contract still needs to be confirmed from its documentation.
  const explicitlyFailed =
    result !== null &&
    typeof result === "object" &&
    (
      ("success" in result && result.success === false) ||
      ("error" in result && Boolean(result.error)) ||
      ("status" in result &&
        ["error", "failed", "failure"].includes(
          String(result.status).toLowerCase(),
        ))
    );

  if (!response.ok || explicitlyFailed) {
    // Never log the request body: it contains the API key and OTP.
    console.error("Wapix request rejected", {
      httpStatus: response.status,
    });

    throw new ApiError(
      502,
      "OTP_DELIVERY_FAILED",
      "OTP provider could not accept the request. Please try again later.",
    );
  }

  // HTTP success does not prove that WhatsApp delivered the message.
}