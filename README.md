## Release

### Create docker images

    vim config.json and update version
    vim app/package.json and do the same version update
    git tag <version>
    git push gh master --tags

### Publish update

    git checkout publish
    vim lartec/config.json and update version
    git commit
    git push publishgh publish:master
