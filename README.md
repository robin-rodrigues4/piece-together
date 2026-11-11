# Piece Together

A touch-first, real-time jigsaw puzzle for two.

- Choose a gallery picture or crop a photo from your phone. Pick 12, 20, 30, 48, or 70 pieces.
- Tap a piece in the swipeable tray, then tap the board. Drag loose pieces and groups on the board.
- Use **Edges only**, **Show picture**, pinch-to-zoom, or the zoom and pan buttons.
- Matching loose neighbors connect. A connected group moves together and snaps into its place.
- Tap **Ping**, then the board, to point out a spot. Your moves are highlighted in lime and your friend's in blue.
- Share the invite link to play or resume. Up to two players can interact at once.

The website is hosted on GitHub Pages. MQTT.js connects the browsers through the public EMQX test relay. The invite contains the key for the encrypted room. The latest completed moves and cropped photo are sent as an encrypted snapshot with a seven-day expiry, subject to public relay retention and availability. The browser keeps a local copy when storage is available. If the player coordinating the room leaves, the other player can take over after a short pause.

For same-browser development, run a local HTTP server and open its URL with `?local=1`. That mode uses BroadcastChannel and a browser-local save. Test public invites at the normal HTTPS URL.
