-- Pintaz baseline: every OSM way with highway=* → layer "roads"
-- Preserves original highway value and selected tags (no merging or filtering by class).

local TAG_KEYS = {
  "name", "ref", "maxspeed", "lanes", "oneway", "bridge", "tunnel",
  "surface", "access", "service", "junction", "layer", "construction",
  "bicycle", "foot", "motor_vehicle",
}

function copy_tags()
  for _, key in ipairs(TAG_KEYS) do
    local v = Find(key)
    if v ~= "" then
      Attribute(key, v)
    end
  end
end

function way_function()
  local highway = Find("highway")
  if highway == "" then
    return
  end

  Layer("roads", false)
  Attribute("highway", highway)
  Attribute("osm_id", tostring(Id()))
  copy_tags()
end
