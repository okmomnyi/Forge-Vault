ForgeVault — image assets
=========================

IMAGES ARE NO LONGER STORED HERE.

Product photos, hero slides, category tiles and partner logos are uploaded from
the admin panel and hosted on ImgBB:

    /admin/media.html      hero slides, category tiles, partner logos
    /admin/products.html   product photos (upload button on each product)

The URL is stored in the database, so a new photo goes live immediately — no
redeploy, no file in this folder.

Anything without an image shows a gradient placeholder with a centred icon, so a
half-finished catalogue never looks broken, and the site makes ZERO requests for
images that do not exist (no 404s, no console errors).

This folder still works for local artwork if you want it: any file placed here
can be referenced as /assets/<name>, and the build picks it up automatically.
It is simply no longer the primary route.

Never hotlink stock photos. Use owned, licensed, or supplier-provided imagery.
