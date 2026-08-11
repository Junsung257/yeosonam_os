# image-size disabled compatibility package

PptxGenJS 4.0.1 declares `image-size` as a runtime dependency, but its only
reference in the distributed JavaScript is inside a commented, explicitly
unused helper. The upstream package currently has unpatched denial-of-service
advisories for crafted image data.

This local package keeps npm's dependency graph valid without shipping the
vulnerable parser. Every exported entry point fails closed. If a future
PptxGenJS release starts using the dependency, presentation tests fail instead
of accepting untrusted image bytes. Product media dimensions continue to be
handled by the platform's verified media pipeline.
