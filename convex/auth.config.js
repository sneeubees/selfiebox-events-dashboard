const clerkIssuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN || "https://clerk.events.selfiebox.co.za";

export default {
  providers: [
    {
      domain: clerkIssuerDomain,
      applicationID: "convex",
    },
  ],
};
