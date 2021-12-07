"""
Lar Tec component.
"""
from __future__ import annotations

import asyncio

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.typing import ConfigType

# The domain of your component. Should be equal to the name of your component.
DOMAIN = "lartec"

"""
Commenting out this: @asyncio.coroutine
"""
async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Setup our skeleton component."""
    hass.states.async_set('lartec.foo', 'Bar')

    @callback
    def message_received(topic: str, payload: str, qos: int) -> None:
        """A new MQTT message has been received."""
        hass.components.mqtt.async_publish("lartec/foo", "Works! 4")

    await hass.components.mqtt.async_subscribe('lartec/init', message_received)

    # Return boolean to indicate that initialization was successfully.
    return True
