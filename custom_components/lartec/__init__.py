"""
LarTec component.
"""
from __future__ import annotations

import asyncio

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.typing import ConfigType
from homeassistant.const import EVENT_TIME_CHANGED, EVENT_STATE_CHANGED, MATCH_ALL

# The domain of your component. Should be equal to the name of your component.
DOMAIN = "lartec"

#
# ON EVENTS
#
async def on_events(hass: HomeAssistant) -> None:
    @callback
    # def forward_event(event: Event) -> None:
    #     """Forward events to mqtt (except time changed ones)."""
    #     if event.event_type == EVENT_TIME_CHANGED:
    #         return

    #     if event.domain == "mqtt":
    #         return
    #     hass.components.mqtt.async_publish("lartec/event", event)

    # All events
    # hass.bus.async_listen(MATCH_ALL, forward_event)

    # State changed events only
    def on_events(event: Event) -> None:
        """Forward state changed events to mqtt (except time changed ones)."""
        hass.components.mqtt.async_publish("lartec/event", event)
    hass.bus.async_listen(EVENT_STATE_CHANGED, on_events)

#
# 
#
async def remote_set_state(hass: HomeAssistant) -> None:
    # Remote setState
    # TODO
    # hass.states.async_set(entity_id, payload)
    # hass.bus.fire("example_component_my_cool_event", {"answer": 42})
    #
    # await hass.components.mqtt.async_subscribe('lartec/setState', message_received)

    return True

#
# 
#
async def remote_set_configure(hass: HomeAssistant) -> None:
    return True

#
# 
#
async def remote_software_update(hass: HomeAssistant) -> None:
    # Remote add new device
    # curl -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H "Content-Type: application/json" http://supervisor/host/reboot

    # Return boolean to indicate that initialization was successfully.
    return True

#
# SETUP
#
async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Setup our skeleton component."""
    @callback
    def message_received(topic: str, payload: str, qos: int) -> None:
        """A new MQTT message has been received."""
        hass.components.mqtt.async_publish("lartec/foo", "Works! 4")
    await hass.components.mqtt.async_subscribe('lartec/init', message_received)

    # On events
    await on_events(hass)

    # Remote setState
    await remote_set_state(hass)

    # Remote setConfigure
    await remote_set_configure(hass)

    # Remote softwareUpdate
    await remote_software_update(hass)

    # Return boolean to indicate that initialization was successfully.
    hass.states.async_set('lartec.status', 'OK')
    return True
