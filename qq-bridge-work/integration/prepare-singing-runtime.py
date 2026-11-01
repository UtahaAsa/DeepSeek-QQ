"""Bind the completed isolated RVC candidate to verified local inference assets."""
import hashlib
import json
from pathlib import Path
import shutil
import uuid

PROJECT=Path(__file__).resolve().parents[1]
ROOT=PROJECT/'singing-rvc'


def digest(file):
    value=hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            value.update(chunk)
    return value.hexdigest()


def main():
    """Create only the new singing runtime config and one held-out speech test job."""
    training=json.loads((ROOT/'reports/trial-training-state.json').read_text(encoding='utf-8'))
    if training['status']!='completed':
        raise RuntimeError('RVC training/export validation is incomplete')
    for key in ('model','index'):
        if digest(ROOT/training[key])!=training[key+'Sha256']:
            raise RuntimeError('Candidate resource changed after validation')
    assets=json.loads((ROOT/'reports/base-model-download-state.json').read_text(encoding='utf-8'))
    if assets['status']!='completed':
        raise RuntimeError('Base models are not verified')
    config=json.loads((PROJECT/'templates/rvc-resources.example.json').read_text(encoding='utf-8'))
    config.update(enabled=True,voiceModel={'path':training['model'],'sha256':training['modelSha256']},
                  index={'path':training['index'],'sha256':training['indexSha256']})
    known={item['path']:item['sha256'] for item in assets['completed']}
    config['baseAssets']={name:known[name] for name in config['baseAssets']}
    config['ffmpegSha256']=digest(PROJECT/'integration/data/bridge/ffmpeg.exe')
    destination=ROOT/'runtime.json'
    if destination.exists() and json.loads(destination.read_text(encoding='utf-8'))!=config:
        raise RuntimeError('Existing singing configuration differs; refusing overwrite')
    destination.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    voice=PROJECT.parent/'voice'
    dataset=json.loads((voice/'training/deepseek-trial-01/dataset.json').read_text(encoding='utf-8-sig'))
    item=next(row for row in dataset['items'] if row['id']==dataset['heldout_id'])
    source=Path(item['source_audio']).resolve(strict=True)
    if not source.is_relative_to(voice.resolve()) or digest(source)!=item['sha256']:
        raise RuntimeError('Held-out approved source differs')
    job=uuid.uuid4().hex
    folder=ROOT/'jobs'/job
    folder.mkdir(parents=True)
    shutil.copyfile(source,folder/'vocal.wav')
    request={'id':job,'op':'convert','pitch':0,'backingGain':0.65}
    (folder/'request.json').write_text(json.dumps(request)+'\n',encoding='utf-8')
    report={'kind':'heldout_speech_inference_path_check_not_singing_acceptance','job':job,'model':training['model'],
            'sourceAudioHashVerified':True,'modelHumanAccepted':False,'connectedToLiveBridge':False,
            'originalSpeakingVoiceChanged':False,'requestFile':str(folder/'request.json')}
    (ROOT/'reports/inference-probe-job.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'runtimePrepared':True,'job':job,'humanAccepted':False,'originalSpeakingVoiceChanged':False}))


if __name__=='__main__':
    main()
