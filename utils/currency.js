import axios from "axios";

export async function convertToINR(amount, currency) {
  if (!amount || !currency) return null;

  const normalizedCurrency = String(currency).toUpperCase();

  if (normalizedCurrency === "INR") {
    return Number(amount);
  }

  try {
    const response = await axios.get(
      `https://api.frankfurter.app/latest?amount=${amount}&from=${normalizedCurrency}&to=INR`
    );

    return response.data?.rates?.INR ?? null;
  } catch (error) {
    console.error("Currency conversion failed:", error.message);
    return null;
  }
}