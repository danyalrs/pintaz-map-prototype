node_keys = {}

function init_function()
end

function node_function(node)
end

function way_function(way)
  local highway = way:Find("highway")
  if highway == "" then
    return
  end
  way:Layer("roads", false)
  way:Attribute("highway", highway)
  way:Attribute("osm_id", string.format("%d", way:Id()))
  local name = way:Find("name")
  if name ~= "" then way:Attribute("name", name) end
  local ref = way:Find("ref")
  if ref ~= "" then way:Attribute("ref", ref) end
  local maxspeed = way:Find("maxspeed")
  if maxspeed ~= "" then way:Attribute("maxspeed", maxspeed) end
  local lanes = way:Find("lanes")
  if lanes ~= "" then way:Attribute("lanes", lanes) end
  local oneway = way:Find("oneway")
  if oneway ~= "" then way:Attribute("oneway", oneway) end
  local bridge = way:Find("bridge")
  if bridge ~= "" then way:Attribute("bridge", bridge) end
  local tunnel = way:Find("tunnel")
  if tunnel ~= "" then way:Attribute("tunnel", tunnel) end
  local surface = way:Find("surface")
  if surface ~= "" then way:Attribute("surface", surface) end
  local access = way:Find("access")
  if access ~= "" then way:Attribute("access", access) end
  local service = way:Find("service")
  if service ~= "" then way:Attribute("service", service) end
  local junction = way:Find("junction")
  if junction ~= "" then way:Attribute("junction", junction) end
  local layer = way:Find("layer")
  if layer ~= "" then way:Attribute("layer", layer) end
  local construction = way:Find("construction")
  if construction ~= "" then way:Attribute("construction", construction) end
  local bicycle = way:Find("bicycle")
  if bicycle ~= "" then way:Attribute("bicycle", bicycle) end
  local foot = way:Find("foot")
  if foot ~= "" then way:Attribute("foot", foot) end
  local motor_vehicle = way:Find("motor_vehicle")
  if motor_vehicle ~= "" then way:Attribute("motor_vehicle", motor_vehicle) end
end
