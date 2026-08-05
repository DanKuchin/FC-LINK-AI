-- TENURE spike 04 — fixtures / standings probe.
--
-- All build-sensitive memory offsets live in one guarded file. Keeping this
-- launcher offset-free is deliberate: a game patch must have exactly one
-- memory-archeology surface.
require 'tenure/readers/fixtures_offsets'
