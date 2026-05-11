import { Resource } from "alchemy";
import {
	type CloudflareApiOptions,
	createCloudflareApi,
	findZoneForHostname,
} from "alchemy/cloudflare";

type ToggleValue = "off" | "on";

export interface CloudflareZoneSettingProps extends CloudflareApiOptions {
	hostname: string;
	settingId: string;
	value: ToggleValue;
}

export interface CloudflareZoneSetting {
	hostname: string;
	settingId: string;
	value: ToggleValue;
	zoneId: string;
	zoneName: string;
}

interface CloudflareZoneSettingResponse {
	result: {
		id: string;
		value: ToggleValue;
	};
}

export const CloudflareZoneSetting = Resource(
	"custom::CloudflareZoneSetting",
	async function (
		this,
		_id: string,
		props: CloudflareZoneSettingProps
	): Promise<CloudflareZoneSetting> {
		if (this.phase === "delete") {
			return this.destroy();
		}

		const api = await createCloudflareApi(props);
		const { zoneId, zoneName } = await findZoneForHostname(api, props.hostname);
		const response = await api.patch(
			`/zones/${zoneId}/settings/${props.settingId}`,
			{
				value: props.value,
			}
		);

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`Failed to update Cloudflare zone setting ${props.settingId}: ${response.status} ${response.statusText}\n${body}`
			);
		}

		const data = (await response.json()) as CloudflareZoneSettingResponse;
		return this.create({
			hostname: props.hostname,
			settingId: data.result.id,
			value: data.result.value,
			zoneId,
			zoneName,
		});
	}
);
