"use client"

import PaymentSuccessView from './PaymentSuccessView'

/**
 * Re-export PaymentSuccessView as PaymentSuccessModal for backward compatibility.
 * Implements Full-Screen Stage View, Kiosk Armor against pull-to-refresh,
 * and resilient mobile back button handling (preventing /onboarding redirection).
 */
export default PaymentSuccessView
