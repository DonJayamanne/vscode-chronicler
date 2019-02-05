import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as util from 'util';
import { RecordingOptions } from './types';
import { Installer, InstallerHelper, FFMpegInstallPickerOptions } from './installer';

const exists = util.promisify(fs.exists);

export class Config {
  private static get _config() {
    return vscode.workspace.getConfiguration();
  }

  static isDebugMode() {
    return !!this._config.get('chronicler.debug');
  }

  static getRecordingDefaults() {
    return {
      duration: 0,
      fps: 10,
      animatedGif: false,
      countdown: 5,
      ...(this._config.get('chronicler.recording-defaults') || {})
    } as RecordingOptions;
  }

  static async getDestFolder() {
    if (!this._config.get('chronicler.dest-folder')) {
      await this._config.update('chronicler.dest-folder', '~/Recordings', vscode.ConfigurationTarget.Global);
    }

    return (this._config.get('chronicler.dest-folder') as string).replace(/^~/, process.env.HOME || process.env.USERPROFILE || '.');
  }

  static async getFilename() {
    const dir = await this.getDestFolder();
    const folders = vscode.workspace.workspaceFolders;
    const ws = folders ? folders![0].name.replace(/[^A-Za-z0-9\-_]+/g, '_') : `vscode`;
    const base = `${ws}-${new Date().getTime()}.mp4`;

    if (!(await exists(dir))) {
      await util.promisify(fs.mkdir)(dir);
    }

    return path.join(dir, base);
  }

  static async getLocation(key: string, context:vscode.ExtensionContext, options: FFMpegInstallPickerOptions) {
    key = `chronicler.${key}`;

    if (!this._config.get(key)) {
      const platform = os.platform();

      const folders = options.platformDefaults ? (options.platformDefaults[platform as 'darwin' | 'win32'] || options.platformDefaults.x11 || []) : [];

      let valid = undefined;

      if (options.folder) {
        for (const p of folders) {
          if (await exists(p)) {
            valid = p;
            break;
          }
        }
      } else if (options.defaultName) {
        const paths = [...folders];
        if (options.executable) {
          paths.unshift(...(process.env.PATH || '')
            .split(path.delimiter)
            .map(x => path.resolve(x, options.defaultName!))
          );
        }
        for (const p of paths) {
          if (await exists(p)) {
            valid = p;
            break;
          }
        }
      }

      let file;

      if (valid) {
        file = valid;
			} else {
				const installer = new Installer(context, new InstallerHelper(context));
				file = await installer.getInstallDirectory(options);
				if (!file) {
					return;
				}
      }

      if ((await exists(file)) && (!options.validator || (await options.validator(file)))) {
        await this._config.update(key, file, vscode.ConfigurationTarget.Global);
      } else {
        throw new Error(`Invalid location for ${options.title}: ${file}`);
      }

      if (options.onAdd) {
        await options.onAdd(file);
      }
    }
    return this._config.get(key) as string;
  }

  static async getFFmpegBinary(context:vscode.ExtensionContext) {
    return this.getLocation('ffmpeg-binary', context, {
      title: 'FFMpeg Binary',
      folder: false,
      defaultName: 'ffmpeg',
      executable: true,
      validator: file => /ffmpeg/i.test(file)
    });
  }
}
